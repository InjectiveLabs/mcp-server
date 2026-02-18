import { getNetworkEndpoints, getNetworkChainInfo, Network } from '@injectivelabs/networks'

export type NetworkName = 'mainnet' | 'testnet'

export interface Config {
  network: NetworkName
  endpoints: {
    indexer: string
    grpc: string
    rest: string
  }
  chainId: string
  ethereumChainId: number
}

const VALID_NETWORKS = new Set<string>(['mainnet', 'testnet'])

const NETWORK_MAP: Record<NetworkName, Network> = {
  mainnet: Network.MainnetSentry,
  testnet: Network.TestnetSentry,
}

// Injective EVM chain IDs from official network docs.
// Mainnet: 1776, Testnet: 1439.
const EVM_CHAIN_ID_MAP: Record<NetworkName, number> = {
  mainnet: 1776,
  testnet: 1439,
}

export function validateNetwork(value: string): NetworkName {
  if (!VALID_NETWORKS.has(value)) {
    throw new Error(`Invalid network "${value}" — must be "mainnet" or "testnet"`)
  }
  return value as NetworkName
}

export function createConfig(network: NetworkName = 'testnet'): Config {
  const injectiveNetwork = NETWORK_MAP[network]
  const endpoints = getNetworkEndpoints(injectiveNetwork)
  const chainInfo = getNetworkChainInfo(injectiveNetwork)

  return {
    network,
    endpoints: {
      indexer: endpoints.indexer,
      grpc: endpoints.grpc,
      rest: endpoints.rest,
    },
    chainId: chainInfo.chainId,
    ethereumChainId: EVM_CHAIN_ID_MAP[network],
  }
}
