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

const NETWORK_MAP: Record<NetworkName, Network> = {
  mainnet: Network.MainnetSentry,
  testnet: Network.TestnetSentry,
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
    ethereumChainId: Number(chainInfo.evmChainId ?? 0),
  }
}
