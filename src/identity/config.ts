import type { NetworkName } from '../config/index.js'

export interface IdentityConfig {
  chainId: number
  rpcUrl: string
  identityRegistry: `0x${string}`
  reputationRegistry: `0x${string}`
  deployBlock: bigint
}

// EVM JSON-RPC chain IDs per PRD-021. These are for viem JSON-RPC calls to
// Injective EVM and may differ from the ethereumChainId in src/config/ which
// is used for Cosmos-wrapped EVM transactions. Verify against the actual
// JSON-RPC endpoint (`eth_chainId`) before shipping to production.

const TESTNET: IdentityConfig = {
  chainId: 1439,
  rpcUrl: 'https://testnet.sentry.chain.json-rpc.injective.network',
  identityRegistry: '0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e',
  reputationRegistry: '0x019b24a73d493d86c61cc5dfea32e4865eecb922',
  deployBlock: 0n,
}

const MAINNET: IdentityConfig = {
  chainId: 2525,
  rpcUrl: 'https://json-rpc.injective.network',
  identityRegistry: '0x0000000000000000000000000000000000000003', // TODO: real address
  reputationRegistry: '0x0000000000000000000000000000000000000004', // TODO: real address
  deployBlock: 0n,
}

const CONFIGS: Record<NetworkName, IdentityConfig> = {
  testnet: TESTNET,
  mainnet: MAINNET,
}

export function getIdentityConfig(network: NetworkName): IdentityConfig {
  return CONFIGS[network]
}
