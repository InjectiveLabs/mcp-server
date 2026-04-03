#!/usr/bin/env npx tsx
import { createPublicClient, http, defineChain, encodeFunctionData } from 'viem'

const chain = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.sentry.chain.json-rpc.injective.network'] } },
})

const client = createPublicClient({ chain, transport: http() })
const REP = '0x019b24a73d493d86c61cc5dfea32e4865eecb922' as const
const ACCOUNT = '0x2968698C6b9Ed6D44b667a0b1F312a3b5D94Ded7' as const

async function tryCall(name: string, types: string[], args: any[]) {
  const abi = [{
    type: 'function' as const,
    name,
    inputs: types.map((t, i) => ({ name: `p${i}`, type: t })),
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view' as const,
  }]
  try {
    const data = encodeFunctionData({ abi, functionName: name, args })
    const result = await client.call({ to: REP, data, account: ACCOUNT })
    console.log(`✅ ${name}(${types.join(',')}) → ${result.data?.slice(0, 130)}`)
  } catch (err: any) {
    const detail = err.message?.match(/Details: (.+?)$/m)?.[1] || 'reverted'
    console.log(`❌ ${name}(${types.join(',')}) — ${detail}`)
  }
}

async function main() {
  // Try getClients (known selector)
  await tryCall('getClients', ['uint256'], [10n])

  // Try getVersion
  const versionAbi = [{ type: 'function' as const, name: 'getVersion', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' as const }]
  try {
    const v = await client.readContract({ address: REP, abi: versionAbi, functionName: 'getVersion', args: [] })
    console.log(`Version: ${v}`)
  } catch { console.log('getVersion failed') }

  // Try various submit/add review patterns
  console.log('\n--- Write functions (simulated) ---')
  await tryCall('submitFeedback', ['uint256', 'uint256', 'uint8', 'string'], [10n, 10n, 5, 'Great'])
  await tryCall('submitFeedback', ['uint256', 'uint8', 'string'], [10n, 5, 'Great'])
  await tryCall('addFeedback', ['uint256', 'uint8', 'string'], [10n, 5, 'Great'])
  await tryCall('evaluate', ['uint256', 'uint8', 'string'], [10n, 5, 'Great'])
  await tryCall('submitReview', ['uint256', 'uint256', 'uint8', 'string'], [10n, 10n, 5, 'Great'])
  await tryCall('rateAgent', ['uint256', 'uint8', 'string'], [10n, 5, 'Great'])
  await tryCall('rateAgent', ['uint256', 'uint8'], [10n, 5])
  await tryCall('setReputation', ['uint256', 'uint256'], [10n, 85n])
  await tryCall('addReputation', ['uint256', 'uint256'], [10n, 85n])
  await tryCall('submitReview', ['uint256', 'uint8', 'string', 'bytes'], [10n, 5, 'Great', '0x'])

  // ERC-8183 patterns
  console.log('\n--- ERC-8183 patterns ---')
  await tryCall('submitEvaluation', ['uint256', 'uint256', 'uint8', 'string'], [10n, 10n, 5, 'Great'])
  await tryCall('submitEvaluation', ['uint256', 'uint8', 'string'], [10n, 5, 'Great'])
  await tryCall('getEvaluations', ['uint256'], [10n])
  await tryCall('getAverageScore', ['uint256'], [10n])
  await tryCall('getReviewCount', ['uint256'], [10n])
  await tryCall('getFeedback', ['uint256'], [10n])
  await tryCall('getClientReviews', ['uint256'], [10n])

  // Try direct hex probe of unknown selectors with uint256 arg
  console.log('\n--- Unknown selectors with uint256(10) ---')
  const unknowns = ['0x21eed1cd', '0x232b0810', '0x3c036a7e', '0x4ab3ca99', '0x60405196',
    '0x6caf395f', '0x6e04cacd', '0x81bbba58', '0xbc4d861b', '0xc2349ab2', '0xc788147b',
    '0xd9d84224', '0xf2d81759']
  for (const sel of unknowns) {
    const data = (sel + '000000000000000000000000000000000000000000000000000000000000000a') as `0x${string}`
    try {
      const result = await client.call({ to: REP, data, account: ACCOUNT })
      console.log(`✅ ${sel}(10) → ${result.data?.slice(0, 130)}`)
    } catch (err: any) {
      const detail = err.message?.match(/Details: (.+?)$/m)?.[1] || 'reverted'
      console.log(`❌ ${sel}(10) — ${detail}`)
    }
  }
}

main().catch(console.error)
