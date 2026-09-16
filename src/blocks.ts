import type { PublicClient } from 'viem';

async function blockTs(client: PublicClient, n: bigint): Promise<number> {
  const b = await client.getBlock({ blockNumber: n });
  return Number(b.timestamp);
}

/**
 * First block whose timestamp is >= `ts`. Brackets the answer using the
 * observed average block time, then binary-searches inside the bracket.
 */
export async function findBlockByTimestamp(client: PublicClient, ts: number, latest?: bigint): Promise<bigint> {
  const hiBlock = latest ?? (await client.getBlockNumber());
  const hiTs = await blockTs(client, hiBlock);
  if (hiTs < ts) return hiBlock + 1n; // ts is in the future → no block yet

  // Estimate block time from a sample and bracket the target.
  const sample = hiBlock > 10_000n ? 10_000n : hiBlock;
  const sampleTs = await blockTs(client, hiBlock - sample);
  const secPerBlock = Math.max((hiTs - sampleTs) / Number(sample), 0.01);

  let lo = 0n;
  let hi = hiBlock;
  const guess = hiBlock - BigInt(Math.ceil((hiTs - ts) / secPerBlock));
  const margin = BigInt(Math.ceil((hiTs - ts) / secPerBlock * 0.1)) + 1000n;
  const gLo = guess - margin < 0n ? 0n : guess - margin;
  const gHi = guess + margin > hiBlock ? hiBlock : guess + margin;
  if ((await blockTs(client, gLo)) < ts && (await blockTs(client, gHi)) >= ts) {
    lo = gLo;
    hi = gHi;
  }

  // Invariant: ts(lo) < ts <= ts(hi)  (lo=0 is treated as "before")
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if ((await blockTs(client, mid)) >= ts) hi = mid;
    else lo = mid;
  }
  return hi;
}
