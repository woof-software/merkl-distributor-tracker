import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { PublicClient } from 'viem';
import { LAUNCH_TIMESTAMP, type ChainConfig } from './config.js';
import { findBlockByTimestamp } from './blocks.js';

interface Entry { launchTimestamp: number; block: string }

// One file per chain: chains are processed concurrently and must not clobber each other.
const file = (c: ChainConfig) => `data/launch-block-${c.key}.json`;

/** Launch block per chain is immutable, so it is looked up once and cached on disk. */
export async function getLaunchBlock(client: PublicClient, c: ChainConfig): Promise<bigint> {
  try {
    const hit = JSON.parse(readFileSync(file(c), 'utf8')) as Entry;
    if (hit.launchTimestamp === LAUNCH_TIMESTAMP) return BigInt(hit.block);
  } catch { /* no cache yet */ }

  const block = await findBlockByTimestamp(client, LAUNCH_TIMESTAMP);
  mkdirSync('data', { recursive: true });
  writeFileSync(file(c), JSON.stringify({ launchTimestamp: LAUNCH_TIMESTAMP, block: block.toString() } satisfies Entry, null, 2));
  return block;
}
