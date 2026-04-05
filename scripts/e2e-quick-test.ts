#!/usr/bin/env npx tsx
/**
 * Quick E2E test: register an agent, then verify reads (status, reputation, feedback).
 *
 * Usage:
 *   INJECTIVE_PRIVATE_KEY=0x... PINATA_JWT=... npx tsx scripts/e2e-quick-test.ts
 *
 * Note: feedback requires a second (non-owner) wallet — the contract rejects
 * self-feedback. Use scripts/full-flow-test.ts for the full feedback+revoke lifecycle.
 */

import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'
import { getTestPrivateKey } from '../src/test-utils/index.js'
import { privateKeyToAccount } from 'viem/accounts'

if (!process.env['PINATA_JWT']) {
  console.error('❌ Set PINATA_JWT')
  process.exit(1)
}

const config = createConfig('testnet')
const PASSWORD = 'test-' + Date.now()

async function main() {
  const pk = getTestPrivateKey()
  const ts = Date.now()
  const { address } = wallets.import(pk, PASSWORD, 'test-' + ts)
  const evmAddress = privateKeyToAccount(pk as `0x${string}`).address

  console.log(`\n🔐 Main wallet: ${address}`)
  console.log(`   EVM: ${evmAddress}\n`)

  // ─── Register agent ────────────────────────────────────────────────────

  console.log('📝 Registering agent...')
  const agentName = 'E2E-' + ts

  const regResult = await identity.register(config, {
    address,
    password: PASSWORD,
    name: agentName,
    type: 'trading',
    builderCode: 'e2e-' + ts,
    description: 'Full E2E test agent with metadata and services',
    image: 'https://picsum.photos/256?random=' + ts,
    services: [
      { type: 'mcp', url: 'https://test.example.com', description: 'Test service' },
    ],
  })

  console.log(`✅ Registered!`)
  console.log(`   ID: ${regResult.agentId}`)
  console.log(`   TX: ${regResult.txHash}`)
  console.log(`   Card URI: ${regResult.cardUri}\n`)

  const agentId = regResult.agentId

  // ─── Reads (concurrent — no data dependency between them) ─────────────

  console.log('📊 Fetching status, reputation, and feedback in parallel...')
  const [status, rep, fbList] = await Promise.all([
    identityRead.status(config, { agentId }),
    identityRead.reputation(config, { agentId }),
    identityRead.feedbackList(config, { agentId }),
  ])

  console.log(`✅ Status: ${status.name}`)
  console.log(`   Type: ${status.agentType} | Builder: ${status.builderCode}`)
  console.log(`   Reputation: ${status.reputation.score}/${status.reputation.count}`)
  console.log(`✅ Reputation: score=${rep.score}, count=${rep.count}`)
  console.log(`✅ Feedback entries: ${fbList.entries.length}\n`)

  console.log(`✨ E2E test complete (registration + reads)!`)
  console.log(`Agent: ${agentName} (ID: ${agentId})`)
  console.log(`For feedback/revoke lifecycle: npx tsx scripts/full-flow-test.ts`)
}

main().catch((err) => {
  console.error('\n❌ Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
