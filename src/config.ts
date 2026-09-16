import 'dotenv/config';
import { arbitrum, base, mainnet, optimism, polygon, unichain } from 'viem/chains';
import { parseUnits, type Address, type Chain } from 'viem';

/** Merkl Distributor — same address on every supported chain. */
export const DISTRIBUTOR: Address = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae';

/** Reward token being tracked: COMP (wrapped), 18 decimals. Same address on every chain. */
export const TOKEN: Address = '0x53350F755340aAee07277CF69574CF70ac4746dc';
export const TOKEN_SYMBOL = 'COMP';
export const TOKEN_DECIMALS = 18;

/** Campaign launch: Sep-10-2026 10:19:47 PM UTC. Nothing before this block is counted. */
export const LAUNCH_TIMESTAMP = Math.floor(Date.parse('2026-09-10T22:19:47Z') / 1000);

/** Multisig that holds native COMP backing the campaigns. Same address on every chain. */
export const MULTISIG: Address = '0xf06DFee756D79065d30337D0cE2A366A85318bea';

export interface ChainConfig {
  key: string;
  name: string;
  chain: Chain;
  rpcEnv: string;
  explorerTx: (hash: string) => string;
  /** Native (bridged) COMP token on this chain — what the multisig holds. */
  nativeComp: Address;
  /** Campaign budget on this chain, in COMP wei. */
  budget: bigint;
}

const comp = (n: string) => parseUnits(n, TOKEN_DECIMALS);

export const CHAINS: ChainConfig[] = [
  { key: 'ethereum', name: 'Ethereum', chain: mainnet,  rpcEnv: 'RPC_MAINNET',  explorerTx: (h) => `https://etherscan.io/tx/${h}`,
    nativeComp: '0xc00e94Cb662C3520282E6f5717214004A7f26888', budget: comp('92947.7942') },
  { key: 'base',     name: 'Base',     chain: base,     rpcEnv: 'RPC_BASE',     explorerTx: (h) => `https://basescan.org/tx/${h}`,
    nativeComp: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0', budget: comp('3658.6913') },
  { key: 'arbitrum', name: 'Arbitrum', chain: arbitrum, rpcEnv: 'RPC_ARBITRUM', explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
    nativeComp: '0x354A6dA3fcde098F8389cad84b0182725c6C91dE', budget: comp('7278.8073') },
  { key: 'unichain', name: 'Unichain', chain: unichain, rpcEnv: 'RPC_UNICHAIN', explorerTx: (h) => `https://uniscan.xyz/tx/${h}`,
    nativeComp: '0xdf78e4F0A8279942ca68046476919A90f2288656', budget: comp('917.7690') },
  { key: 'polygon',  name: 'Polygon',  chain: polygon,  rpcEnv: 'RPC_POLYGON',  explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
    nativeComp: '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c', budget: comp('625.2496') },
  { key: 'optimism', name: 'Optimism', chain: optimism, rpcEnv: 'RPC_OPTIMISM', explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    nativeComp: '0x7e7d4467112689329f7E06571eD0E8CbAd4910eE', budget: comp('1499.3714') },
];

export function rpcUrl(c: ChainConfig): string {
  const url = process.env[c.rpcEnv];
  if (!url) throw new Error(`Missing env var ${c.rpcEnv} for ${c.name}`);
  return url;
}

export const WINDOW_HOURS = Number(process.env.WINDOW_HOURS ?? 24);
