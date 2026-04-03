#!/usr/bin/env npx tsx
import { createPublicClient, http, defineChain, toHex } from 'viem'
import { IDENTITY_REGISTRY_ABI } from '../src/identity/abis.js'
import { encodeStringMetadata, decodeStringMetadata } from '../src/identity/helpers.js'

const chain = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.sentry.chain.json-rpc.injective.network'] } },
})

const client = createPublicClient({ chain, transport: http() })
const REGISTRY = '0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e' as const

async function main() {
  // Read what's stored for the "image" key
  const raw = await client.readContract({
    address: REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'getMetadata',
    args: [10n, 'image'],
  }) as `0x${string}`

  console.log('Raw bytes for "image" key:', raw)
  console.log('Decoded:', decodeStringMetadata(raw))
  console.log()

  // Check what the agent-sdk explorer expects — maybe it wants raw UTF-8 bytes, not ABI-encoded
  const imageUrl = 'https://picsum.photos/id/982/400/400'
  console.log('ABI-encoded:', encodeStringMetadata(imageUrl))
  console.log('Raw UTF-8 hex:', toHex(imageUrl))
  console.log()

  // Also check other metadata keys to see what format they use
  for (const key of ['name', 'agentType', 'builderCode']) {
    const val = await client.readContract({
      address: REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [10n, key],
    }) as `0x${string}`
    console.log(`${key}: raw=${val.slice(0, 40)}... decoded="${decodeStringMetadata(val)}"`)
  }
}

main().catch(console.error)
