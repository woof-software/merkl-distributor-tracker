import { createPublicClient, erc20Abi, http, type Hash, type PublicClient } from 'viem';
import { CHAINS, LAUNCH_TIMESTAMP, MULTISIG, rpcUrl, type ChainConfig } from './config.js';
import { fetchClaims, type Claim } from './claims.js';
import { findBlockByTimestamp } from './blocks.js';
import { getLaunchBlock } from './launchBlocks.js';

export interface TxSummary {
  txHash: Hash;
  blockNumber: bigint;
  timestamp: number;
  amount: bigint;      // sum of Claimed amounts for TOKEN inside this tx
  users: string[];     // distinct claimers inside this tx
}

export interface Stats {
  amount: bigint;
  txCount: number;
  claimCount: number;   // number of Claimed events
  uniqueUsers: number;
}

export interface ChainReport {
  chain: ChainConfig;
  fromBlock: bigint;      // launch block
  windowStartBlock: bigint;
  toBlock: bigint;        // latest block used
  daily: Stats;
  total: Stats;
  dailyTxs: TxSummary[];
  budget: bigint;        // campaign budget on this chain (COMP wei)
  multisigBalance: bigint;  // native COMP held by the multisig at toBlock
  error?: string;
}

export interface Report {
  generatedAt: number;     // unix seconds
  windowStart: number;     // unix seconds
  windowEnd: number;       // unix seconds
  launchTimestamp: number;
  chains: ChainReport[];
  daily: Stats;
  total: Stats;
  budget: bigint;        // sum of per-chain budgets (only chains included in the report)
  multisigBalance: bigint;  // sum of per-chain multisig balances
}

function stats(claims: Claim[]): Stats {
  return {
    amount: claims.reduce((s, c) => s + c.amount, 0n),
    txCount: new Set(claims.map((c) => c.txHash)).size,
    claimCount: claims.length,
    uniqueUsers: new Set(claims.map((c) => c.user.toLowerCase())).size,
  };
}

function sumStats(list: Stats[]): Stats {
  // uniqueUsers across chains is not derivable from per-chain counts; summed for a rough figure.
  return list.reduce(
    (a, s) => ({
      amount: a.amount + s.amount,
      txCount: a.txCount + s.txCount,
      claimCount: a.claimCount + s.claimCount,
      uniqueUsers: a.uniqueUsers + s.uniqueUsers,
    }),
    { amount: 0n, txCount: 0, claimCount: 0, uniqueUsers: 0 },
  );
}

async function groupByTx(client: PublicClient, claims: Claim[]): Promise<TxSummary[]> {
  const byTx = new Map<Hash, TxSummary>();
  for (const c of claims) {
    const t = byTx.get(c.txHash);
    if (t) {
      t.amount += c.amount;
      if (!t.users.includes(c.user)) t.users.push(c.user);
    } else {
      byTx.set(c.txHash, { txHash: c.txHash, blockNumber: c.blockNumber, timestamp: 0, amount: c.amount, users: [c.user] });
    }
  }
  // Resolve block timestamps (only for the daily window → small set of blocks).
  const blocks = [...new Set([...byTx.values()].map((t) => t.blockNumber))];
  const ts = new Map<bigint, number>();
  await Promise.all(
    blocks.map(async (b) => ts.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))),
  );
  return [...byTx.values()]
    .map((t) => ({ ...t, timestamp: ts.get(t.blockNumber) ?? 0 }))
    .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
}

async function buildChainReport(c: ChainConfig, windowStart: number, windowEnd: number | null): Promise<ChainReport> {
  const client = createPublicClient({ chain: c.chain, transport: http(rpcUrl(c), { retryCount: 3 }) });

  const latest = await client.getBlockNumber();
  const toBlock = windowEnd === null ? latest : (await findBlockByTimestamp(client, windowEnd, latest)) - 1n;
  const fromBlock = await getLaunchBlock(client, c);
  const windowStartBlock = await findBlockByTimestamp(client, windowStart, latest);

  const [all, multisigBalance] = await Promise.all([
    fetchClaims(client, fromBlock, toBlock),
    client.readContract({ address: c.nativeComp, abi: erc20Abi, functionName: 'balanceOf', args: [MULTISIG], blockNumber: toBlock }),
  ]);
  const daily = all.filter((cl) => cl.blockNumber >= windowStartBlock);

  return {
    chain: c,
    fromBlock,
    windowStartBlock,
    toBlock,
    total: stats(all),
    daily: stats(daily),
    dailyTxs: await groupByTx(client, daily),
    budget: c.budget,
    multisigBalance,
  };
}

export interface BuildOptions {
  /** End of the window, unix seconds. Defaults to "now" (latest block). */
  at?: number;
  windowHours: number;
  chains?: string[]; // chain keys; default all
}

export async function buildReport(opts: BuildOptions): Promise<Report> {
  const now = Math.floor(Date.now() / 1000);
  const windowEnd = opts.at ?? now;
  const windowStart = Math.max(windowEnd - opts.windowHours * 3600, LAUNCH_TIMESTAMP);
  const chains = opts.chains?.length ? CHAINS.filter((c) => opts.chains!.includes(c.key)) : CHAINS;

  const results = await Promise.all(
    chains.map(async (c): Promise<ChainReport> => {
      try {
        return await buildChainReport(c, windowStart, opts.at ?? null);
      } catch (err) {
        const empty: Stats = { amount: 0n, txCount: 0, claimCount: 0, uniqueUsers: 0 };
        return {
          chain: c, fromBlock: 0n, windowStartBlock: 0n, toBlock: 0n,
          daily: empty, total: empty, dailyTxs: [], budget: c.budget, multisigBalance: 0n,
          error: (err as Error).message?.split('\n')[0] ?? String(err),
        };
      }
    }),
  );

  return {
    generatedAt: now,
    windowStart,
    windowEnd,
    launchTimestamp: LAUNCH_TIMESTAMP,
    chains: results,
    daily: sumStats(results.map((r) => r.daily)),
    total: sumStats(results.map((r) => r.total)),
    budget: results.reduce((s, r) => s + r.budget, 0n),
    multisigBalance: results.reduce((s, r) => s + r.multisigBalance, 0n),
  };
}
