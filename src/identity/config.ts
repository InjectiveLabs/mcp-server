import type { NetworkName } from '../config/index.js'

export interface IdentityConfig {
  chainId: number
  rpcUrl: string
  identityRegistry: `0x${string}`
  reputationRegistry: `0x${string}`
  deployBlock: bigint
}

const TESTNET: IdentityConfig = {
  chainId: 1439,
  rpcUrl: 'https://k8s.testnet.json-rpc.injective.network',
  identityRegistry: '0x0000000000000000000000000000000000000001', // TODO: real address
  reputationRegistry: '0x0000000000000000000000000000000000000002', // TODO: real address
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
