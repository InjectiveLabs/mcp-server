#!/usr/bin/env npx tsx
import { createPublicClient, http, defineChain, toFunctionSelector, encodeFunctionData } from 'viem'

const chain = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.sentry.chain.json-rpc.injective.network'] } },
})

const client = createPublicClient({ chain, transport: http() })
const REP_REGISTRY = '0x019b24a73d493d86c61cc5dfea32e4865eecb922' as const
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as `0x${string}`
const ACCOUNT = '0x2968698C6b9Ed6D44b667a0b1F312a3b5D94Ded7' as const

async function main() {
  // Check proxy implementation
  const impl = await client.getStorageAt({ address: REP_REGISTRY, slot: IMPL_SLOT })
  console.log('Implementation:', impl)

  const implAddr = ('0x' + impl!.slice(26)) as `0x${string}`
  const code = await client.getCode({ address: implAddr })
  console.log('Impl code length:', code?.length ?? 0, 'chars\n')

  // Extract function selectors from implementation
  const bytes = Buffer.from(code!.slice(2), 'hex')
  const selectors = new Set<string>()
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x63) selectors.add('0x' + bytes.slice(i + 1, i + 5).toString('hex'))
  }

  console.log(`Found ${selectors.size} PUSH4 values\n`)

  // Look up selectors
  const sorted = [...selectors].sort()
  for (const sel of sorted.slice(0, 40)) {
    try {
      const resp = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${sel}`)
      const data = await resp.json() as { results: { text_signature: string }[] }
      if (data.results?.length > 0) {
        console.log(`${sel}  ${data.results.map((r: any) => r.text_signature).join(' | ')}`)
      } else {
        console.log(`${sel}  (unknown)`)
      }
    } catch {
      console.log(`${sel}  (lookup failed)`)
    }
  }

  // Try some common reputation functions
  console.log('\n--- Probing functions ---')
  const candidates = [
    { name: 'submitReview', sig: 'submitReview(uint256,uint8,string)', args: [10n, 5, 'Great agent!'] },
    { name: 'addReview', sig: 'addReview(uint256,uint8,string)', args: [10n, 5, 'Great agent!'] },
    { name: 'rate', sig: 'rate(uint256,uint8)', args: [10n, 5] },
    { name: 'review', sig: 'review(uint256,uint8,string)', args: [10n, 5, 'Great agent!'] },
    { name: 'getReputation', sig: 'getReputation(uint256)', args: [10n] },
    { name: 'getReviews', sig: 'getReviews(uint256)', args: [10n] },
    { name: 'getScore', sig: 'getScore(uint256)', args: [10n] },
    { name: 'averageRating', sig: 'averageRating(uint256)', args: [10n] },
  ]

  for (const c of candidates) {
    const sel = toFunctionSelector(c.sig)
    const parts = c.sig.match(/^(\w+)\(([^)]*)\)$/)!
    const paramTypes = parts[2] ? parts[2].split(',') : []
    const abi = [{
      type: 'function' as const,
      name: c.name,
      inputs: paramTypes.map((t, i) => ({ name: `p${i}`, type: t.trim() })),
      outputs: [],
      stateMutability: 'nonpayable' as const,
    }]

    try {
      const data = encodeFunctionData({ abi, functionName: c.name, args: c.args as any })
      const result = await client.call({ to: REP_REGISTRY, data, account: ACCOUNT })
      console.log(`✅ ${sel} ${c.sig} → ${result.data?.slice(0, 66)}`)
    } catch (err: any) {
      const msg = err.message?.slice(0, 120) ?? ''
      if (msg.includes('reverted')) {
        console.log(`🔄 ${sel} ${c.sig} — reverted`)
      } else {
        console.log(`❌ ${sel} ${c.sig} — error`)
      }
    }
  }
}

main().catch(console.error)
