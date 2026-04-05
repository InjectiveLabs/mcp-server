#!/usr/bin/env npx tsx
/**
 * Quick E2E test without wallet linking (avoids "deadline too far" SDK issue).
 *
 * Usage:
 *   INJECTIVE_PRIVATE_KEY=0x... PINATA_JWT=... npx tsx scripts/e2e-quick-test.ts
 */

import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'
import { privateKeyToAccount } from 'viem/accounts'

const PRIVATE_KEY = process.env['INJECTIVE_PRIVATE_KEY']
const PINATA_JWT = process.env['PINATA_JWT']

if (!PRIVATE_KEY) {
  console.error('❌ Set INJECTIVE_PRIVATE_KEY')
  process.exit(1)
}
if (!PINATA_JWT) {
  console.error('❌ Set PINATA_JWT')
  process.exit(1)
}

const config = createConfig('testnet')
const PASSWORD = 'test-' + Date.now()

async function main() {
  const pk = PRIVATE_KEY!.startsWith('0x') ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`
  const { address } = wallets.import(pk, PASSWORD, 'test-' + Date.now())
  const evmAddress = privateKeyToAccount(pk as `0x${string}`).address

  console.log(`\n🔐 Main wallet: ${address}`)
  console.log(`   EVM: ${evmAddress}\n`)

  // ─── Register agent ────────────────────────────────────────────────────

  console.log('📝 Registering agent...')
  const agentName = 'E2E-' + Date.now()

  const regResult = await identity.register(config, {
    address,
    password: PASSWORD,
    name: agentName,
    type: 'trading',
    builderCode: 'e2e-' + Date.now(),
    description: 'Full E2E test agent with metadata and services',
    image: 'https://picsum.photos/256?random=' + Date.now(),
    services: [
      { type: 'mcp', url: 'https://test.example.com', description: 'Test service' },
    ],
  })

  console.log(`✅ Registered!`)
  console.log(`   ID: ${regResult.agentId}`)
  console.log(`   TX: ${regResult.txHash}`)
  console.log(`   Card URI: ${regResult.cardUri}\n`)

  const agentId = regResult.agentId

  // ─── Read status ───────────────────────────────────────────────────────

  console.log('📊 Fetching status...')
  const status = await identityRead.status(config, { agentId })
  console.log(`✅ Status: ${status.name}`)
  console.log(`   Type: ${status.agentType}`)
  console.log(`   Builder: ${status.builderCode}`)
  console.log(`   Owner: ${status.owner}`)
  console.log(`   Reputation: ${status.reputation.score}/${status.reputation.count}\n`)

  // ─── Give feedback ─────────────────────────────────────────────────────

  console.log('⭐ Giving feedback...')
  const fbResult = await identity.giveFeedback(config, {
    address,
    password: PASSWORD,
    agentId,
    value: 90,
    valueDecimals: 0,
    tag1: 'accuracy',
    tag2: 'test',
  })
  console.log(`✅ Feedback given!`)
  console.log(`   TX: ${fbResult.txHash}`)
  console.log(`   Index: ${fbResult.feedbackIndex}\n`)

  // Wait for block
  await new Promise((r) => setTimeout(r, 2000))

  // ─── Read reputation ──────────────────────────────────────────────────

  console.log('📈 Fetching reputation...')
  const rep = await identityRead.reputation(config, { agentId })
  console.log(`✅ Reputation:`)
  console.log(`   Score: ${rep.score}`)
  console.log(`   Count: ${rep.count}\n`)

  // ─── List feedback ────────────────────────────────────────────────────

  console.log('📝 Listing feedback...')
  const fbList = await identityRead.feedbackList(config, { agentId })
  console.log(`✅ Found ${fbList.entries.length} entries`)
  fbList.entries.forEach((e) => {
    console.log(`   • #${e.feedbackIndex}: value=${e.value}, tag=${e.tag1}`)
  })
  console.log()

  // ─── Revoke feedback ──────────────────────────────────────────────────

  console.log('🔄 Revoking feedback...')
  const revokeResult = await identity.revokeFeedback(config, {
    address,
    password: PASSWORD,
    agentId,
    feedbackIndex: Number(fbResult.feedbackIndex!),
  })
  console.log(`✅ Revoked!`)
  console.log(`   TX: ${revokeResult.txHash}\n`)

  // Wait for block
  await new Promise((r) => setTimeout(r, 2000))

  // ─── Final reputation ─────────────────────────────────────────────────

  console.log('📈 Final reputation...')
  const rep2 = await identityRead.reputation(config, { agentId })
  console.log(`✅ After revoke:`)
  console.log(`   Score: ${rep2.score}`)
  console.log(`   Count: ${rep2.count}\n`)

  console.log(`✨ Full E2E test complete!`)
  console.log(`Agent: ${agentName} (ID: ${agentId})`)
}

main().catch((err) => {
  console.error('\n❌ Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
