#!/usr/bin/env npx tsx
import { createPublicClient, http, defineChain } from 'viem'

const chain = defineChain({
  id: 1439,
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.sentry.chain.json-rpc.injective.network'] } },
})

const client = createPublicClient({ chain, transport: http() })

async function main() {
  // Use the feedback tx hash from the test
  const txHash = '0x9378880ac49f99c92ab55ffe6a9220dabadedba9048b3b2757ef89ef1241ab54'
  const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })

  console.log('Logs count:', receipt.logs.length)
  for (const log of receipt.logs) {
    console.log('\n--- Log ---')
    console.log('Address:', log.address)
    console.log('Topics:', log.topics)
    console.log('Data:', log.data)
    console.log('Data length:', log.data.length)
  }
}

main().catch(console.error)
