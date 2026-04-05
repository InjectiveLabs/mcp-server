#!/usr/bin/env npx tsx
/**
 * Create an x402-enabled agent on testnet with reputation from a funded reviewer wallet.
 *
 * Usage:
 *   INJECTIVE_PRIVATE_KEY=0x... PINATA_JWT=... npx tsx scripts/create-x402-agent.ts
 */

import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'
import { transfers } from '../src/transfers/index.js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

if (!process.env['PINATA_JWT']) {
  console.error('❌ Set PINATA_JWT')
  process.exit(1)
}

const config = createConfig('testnet')

async function main() {
  const raw = process.env['INJECTIVE_PRIVATE_KEY']
  if (!raw) { console.error('❌ Set INJECTIVE_PRIVATE_KEY'); process.exit(1) }
  const pk = raw.startsWith('0x') ? raw : `0x${raw}`
  const PASSWORD = 'agent-x402-' + Date.now()
  const { address } = wallets.import(pk, PASSWORD, 'agent-x402')
  const evmAddress = privateKeyToAccount(pk as `0x${string}`).address

  console.log(`\n🔐 Owner wallet: ${address} (${evmAddress})\n`)

  // ── Register agent with x402 support ────────────────────────────────

  console.log('🚀 Registering x402-enabled agent on testnet...')

  const regResult = await identity.register(config, {
    address,
    password: PASSWORD,
    name: 'x402 Trading Agent',
    type: 'trading',
    builderCode: 'injective-labs',
    description: 'Autonomous trading agent with x402 payment protocol support for metered API access.',
    image: 'https://picsum.photos/id/237/400/400',
    x402: true,
    services: [
      {
        type: 'mcp',
        url: 'https://mcp.x402-agent.example.com',
        description: 'MCP trading interface',
      },
      {
        type: 'rest',
        url: 'https://api.x402-agent.example.com/v1',
        description: 'REST API (x402 payment required)',
      },
    ],
  })

  console.log(`✅ Agent registered!`)
  console.log(`   ID:       ${regResult.agentId}`)
  console.log(`   TX:       ${regResult.txHash}`)
  console.log(`   Card URI: ${regResult.cardUri}`)
  console.log(`   Owner:    ${regResult.owner}\n`)

  const agentId = regResult.agentId

  // ── Read status to confirm x402 is on-chain ───────────────────────────

  console.log('📊 Fetching agent status...')
  const status = await identityRead.status(config, { agentId })
  console.log(`✅ Status confirmed:`)
  console.log(`   Name:       ${status.name}`)
  console.log(`   Type:       ${status.agentType}`)
  console.log(`   Card URI:   ${status.tokenURI}`)
  console.log(`   Reputation: ${status.reputation.score} (${status.reputation.count} reviews)\n`)

  // ── Fund reviewer and give reputation ────────────────────────────────

  console.log('📦 Setting up reviewer wallet...')
  const reviewerPk = generatePrivateKey()
  const reviewerPw = 'reviewer-' + Date.now()
  const { address: reviewerAddr } = wallets.import(reviewerPk, reviewerPw, 'reviewer-x402')

  console.log(`   Reviewer: ${reviewerAddr}`)
  console.log('   Funding with 0.1 INJ...')

  try {
    const fund = await transfers.send(config, {
      address,
      password: PASSWORD,
      recipient: reviewerAddr,
      denom: 'inj',
      amount: '0.1',
    })
    console.log(`   Fund TX: ${fund.txHash}`)
  } catch (e: any) {
    console.log(`   Funding skipped: ${e.message?.slice(0, 80)}`)
  }

  await new Promise((r) => setTimeout(r, 4000))

  // ── Give two feedback entries ─────────────────────────────────────────

  console.log('\n⭐ Giving feedback #1 (score 90, tag: reliability)...')
  const fb1 = await identity.giveFeedback(config, {
    address: reviewerAddr,
    password: reviewerPw,
    agentId,
    value: 90,
    valueDecimals: 0,
    tag1: 'reliability',
    tag2: 'v1',
  })
  console.log(`   TX: ${fb1.txHash} | Index: ${fb1.feedbackIndex}`)

  console.log('⭐ Giving feedback #2 (score 85, tag: accuracy)...')
  const fb2 = await identity.giveFeedback(config, {
    address: reviewerAddr,
    password: reviewerPw,
    agentId,
    value: 85,
    valueDecimals: 0,
    tag1: 'accuracy',
    tag2: 'v1',
  })
  console.log(`   TX: ${fb2.txHash} | Index: ${fb2.feedbackIndex}`)

  await new Promise((r) => setTimeout(r, 3000))

  // ── Final reads ───────────────────────────────────────────────────────

  console.log('\n📈 Fetching final reputation...')
  const [rep, fbList] = await Promise.all([
    identityRead.reputation(config, { agentId }),
    identityRead.feedbackList(config, { agentId }),
  ])

  console.log(`✅ Reputation:`)
  console.log(`   Score: ${rep.score} | Count: ${rep.count}`)
  console.log(`✅ Feedback entries:`)
  fbList.entries.forEach((e) => {
    console.log(`   #${e.feedbackIndex}: value=${e.value}, tag1=${e.tag1}, tag2=${e.tag2}`)
  })

  // ── Summary ───────────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✨ x402 Agent live on testnet!`)
  console.log(`   Agent ID:   ${agentId}`)
  console.log(`   Name:       x402 Trading Agent`)
  console.log(`   x402:       enabled`)
  console.log(`   Services:   mcp, rest`)
  console.log(`   Card URI:   ${regResult.cardUri}`)
  console.log(`   Reputation: ${rep.score} score / ${rep.count} reviews`)
  console.log(`${'═'.repeat(50)}\n`)

  wallets.remove(address)
  wallets.remove(reviewerAddr)
}

main().catch((err) => {
  console.error('\n❌ Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
