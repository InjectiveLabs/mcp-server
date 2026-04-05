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

  // ─── Read reputation (empty baseline) ────────────────────────────────

  console.log('📈 Fetching reputation (baseline)...')
  const rep = await identityRead.reputation(config, { agentId })
  console.log(`✅ Reputation: score=${rep.score}, count=${rep.count}\n`)

  // ─── List feedback (empty baseline) ──────────────────────────────────

  console.log('📝 Listing feedback (baseline)...')
  const fbList = await identityRead.feedbackList(config, { agentId })
  console.log(`✅ Entries: ${fbList.entries.length}\n`)

  // ─── Note: feedback requires a second (non-owner) wallet ─────────────
  // The contract rejects self-feedback ("Self-feedback not allowed").
  // Use scripts/full-flow-test.ts to test the complete feedback + revoke
  // lifecycle — it funds an ephemeral reviewer wallet automatically.

  console.log(`✨ E2E test complete (registration + reads)!`)
  console.log(`Agent: ${agentName} (ID: ${agentId})`)
  console.log(`For feedback/revoke lifecycle: npx tsx scripts/full-flow-test.ts`)
}

main().catch((err) => {
  console.error('\n❌ Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
