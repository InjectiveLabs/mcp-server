import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PublicClient, WalletClient, Chain } from 'viem'
import type { NetworkName } from '../config/index.js'
import { getIdentityConfig } from './config.js'

function buildChain(network: NetworkName): Chain {
  const cfg = getIdentityConfig(network)
  return defineChain({
    id: cfg.chainId,
    name: network === 'mainnet' ? 'Injective EVM' : 'Injective EVM Testnet',
    nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
    rpcUrls: {
      default: { http: [cfg.rpcUrl] },
    },
  })
}

export function createIdentityPublicClient(network: NetworkName): PublicClient {
  const chain = buildChain(network)
  return createPublicClient({ chain, transport: http() })
}

export function createIdentityWalletClient(
  network: NetworkName,
  privateKeyHex: string,
): WalletClient {
  const chain = buildChain(network)
  const key = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`
  const account = privateKeyToAccount(key as `0x${string}`)
  return createWalletClient({ account, chain, transport: http() })
}
