import { parseAbiItem, type Address, type Hash, type PublicClient } from 'viem';
import { DISTRIBUTOR, TOKEN } from './config.js';

export const CLAIMED_EVENT = parseAbiItem(
  'event Claimed(address indexed user, address indexed token, uint256 amount)',
);

export interface Claim {
  txHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  user: Address;
  amount: bigint;
}

function isRangeTooLarge(err: unknown): boolean {
  const msg = String((err as any)?.details ?? (err as any)?.message ?? err).toLowerCase();
  return (
    msg.includes('response size exceeded') ||
    msg.includes('block range') ||
    msg.includes('query returned more than') ||
    msg.includes('too many') ||
    msg.includes('limit exceeded')
  );
}

/**
 * All `Claimed` events for TOKEN emitted by the Distributor in [from, to].
 * Queries the whole range at once and recursively halves it if the provider
 * rejects the response size.
 */
export async function fetchClaims(client: PublicClient, from: bigint, to: bigint): Promise<Claim[]> {
  if (from > to) return [];
  try {
    const logs = await client.getLogs({
      address: DISTRIBUTOR,
      event: CLAIMED_EVENT,
      args: { token: TOKEN },
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    return logs.map((l) => ({
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      user: l.args.user,
      amount: l.args.amount,
    }));
  } catch (err) {
    if (!isRangeTooLarge(err) || to === from) throw err;
    const mid = from + (to - from) / 2n;
    const [a, b] = await Promise.all([fetchClaims(client, from, mid), fetchClaims(client, mid + 1n, to)]);
    return [...a, ...b];
  }
}
