import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PublicClient, WalletClient, Chain } from 'viem'
import type { NetworkName } from '../config/index.js'
import { getIdentityConfig } from './config.js'

const chainCache = new Map<NetworkName, Chain>()
const publicClientCache = new Map<NetworkName, PublicClient>()

function buildChain(network: NetworkName): Chain {
  const cached = chainCache.get(network)
  if (cached) return cached

  const cfg = getIdentityConfig(network)
  const chain = defineChain({
    id: cfg.chainId,
    name: network === 'mainnet' ? 'Injective EVM' : 'Injective EVM Testnet',
    nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
    rpcUrls: {
      default: { http: [cfg.rpcUrl] },
    },
  })

  chainCache.set(network, chain)
  return chain
}

export function createIdentityPublicClient(network: NetworkName): PublicClient {
  const cached = publicClientCache.get(network)
  if (cached) return cached

  const chain = buildChain(network)
  const client = createPublicClient({ chain, transport: http() })
  publicClientCache.set(network, client)
  return client
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
