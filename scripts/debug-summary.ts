#!/usr/bin/env npx tsx
import { createPublicClient, http, defineChain } from 'viem'
import { REPUTATION_REGISTRY_ABI } from '../src/identity/abis.js'

const chain = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.sentry.chain.json-rpc.injective.network'] } },
})

const client = createPublicClient({ chain, transport: http() })
const REP = '0x019b24a73d493d86c61cc5dfea32e4865eecb922' as const

async function main() {
  // Agent 12 should have 2 feedback entries
  console.log('=== getSummary(12, [], "", "") ===')
  try {
    const result = await client.readContract({
      address: REP,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'getSummary',
      args: [12n, [], '', ''],
    })
    console.log('Result:', result)
  } catch (err: any) {
    console.log('Error:', err.message?.slice(0, 200))
  }

  console.log('\n=== getClients(12) ===')
  try {
    const result = await client.readContract({
      address: REP,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'getClients',
      args: [12n],
    })
    console.log('Clients:', result)
  } catch (err: any) {
    console.log('Error:', err.message?.slice(0, 200))
  }

  console.log('\n=== readAllFeedback(12, [], "", "", false) ===')
  try {
    const result = await client.readContract({
      address: REP,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'readAllFeedback',
      args: [12n, [], '', '', false],
    })
    console.log('Result:', result)
  } catch (err: any) {
    console.log('Error:', err.message?.slice(0, 200))
  }
}

main().catch(console.error)
