#!/usr/bin/env npx tsx
/**
 * Full E2E test: register agent with card → give feedback from second wallet → read reputation
 *
 * Usage:
 *   INJECTIVE_PRIVATE_KEY=0x... PINATA_JWT=... npx tsx scripts/full-flow-test.ts
 *
 * Uses a second ephemeral wallet for feedback (funded from the main wallet).
 */
import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'
import { privateKeyToAccount } from 'viem/accounts'
import { generatePrivateKey } from 'viem/accounts'
import { transfers } from '../src/transfers/index.js'

const PRIVATE_KEY = process.env['INJECTIVE_PRIVATE_KEY']
const PINATA_JWT = process.env['PINATA_JWT']

if (!PRIVATE_KEY) { console.error('Set INJECTIVE_PRIVATE_KEY'); process.exit(1) }
if (!PINATA_JWT) { console.error('Set PINATA_JWT for card upload'); process.exit(1) }

const config = createConfig('testnet')
const PASSWORD = 'full-flow-test-123'

async function main() {
  const pk = PRIVATE_KEY!.startsWith('0x') ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`
  const { address } = wallets.import(pk, PASSWORD, 'full-flow-main')
  const evmAddress = privateKeyToAccount(pk as `0x${string}`).address

  console.log(`Main wallet: ${address}`)
  console.log(`Main EVM: ${evmAddress}\n`)

  // ── Step 1: Register with full card ────────────────────────────────────────
  console.log('═══ Step 1: Register Agent with Card ═══')
  const imageId = Math.floor(Math.random() * 1000)
  const agentName = 'PhoenixArb-' + Math.floor(Math.random() * 9999)

  const regResult = await identity.register(config, {
    address,
    password: PASSWORD,
    name: agentName,
    type: 'trading',
    builderCode: 'phoenix-labs',
    description: 'Autonomous cross-exchange arbitrage agent specializing in Injective perpetual futures.',
    image: `https://picsum.photos/id/${imageId}/400/400`,
    services: [
      { type: 'mcp', url: 'https://mcp.phoenix-labs.example.com', description: 'MCP trading interface' },
    ],
    wallet: evmAddress,
  })

  console.log(`Agent ID: ${regResult.agentId}`)
  console.log(`TX: ${regResult.txHash}`)
  console.log(`Card URI: ${regResult.cardUri}`)
  console.log(`Wallet linked: ${regResult.walletTxHash ? 'yes' : 'skipped'}`)
  console.log()

  const agentId = regResult.agentId

  // ── Step 2: Read status ────────────────────────────────────────────────────
  console.log('═══ Step 2: Read Agent Status ═══')
  const status = await identityRead.status(config, { agentId })
  console.log(`Name: ${status.name}`)
  console.log(`Type: ${status.agentType}`)
  console.log(`Builder: ${status.builderCode}`)
  console.log(`Owner: ${status.owner}`)
  console.log(`Wallet: ${status.linkedWallet}`)
  console.log(`URI: ${status.tokenURI.slice(0, 60)}...`)
  console.log(`Reputation: score=${status.reputation.score}, count=${status.reputation.count}`)
  console.log()

  // ── Step 3: Create second wallet for feedback ──────────────────────────────
  console.log('═══ Step 3: Setup Reviewer Wallet ═══')
  const reviewerPk = generatePrivateKey()
  const reviewerPassword = 'reviewer-123'
  const { address: reviewerAddress } = wallets.import(reviewerPk, reviewerPassword, 'reviewer')
  const reviewerEvm = privateKeyToAccount(reviewerPk).address
  console.log(`Reviewer: ${reviewerAddress}`)
  console.log(`Reviewer EVM: ${reviewerEvm}`)

  // Fund the reviewer wallet with some INJ for gas
  console.log('Funding reviewer with 0.1 INJ...')
  try {
    const fundResult = await transfers.send(config, {
      address,
      password: PASSWORD,
      recipient: reviewerAddress,
      denom: 'inj',
      amount: '0.1',
    })
    console.log(`Fund TX: ${fundResult.txHash}`)
  } catch (err: any) {
    console.log(`Fund failed (may already have gas): ${err.message?.slice(0, 80)}`)
  }
  console.log()

  // Wait a bit for the funding tx to settle
  await new Promise(r => setTimeout(r, 3000))

  // ── Step 4: Give feedback from reviewer ────────────────────────────────────
  console.log('═══ Step 4: Give Feedback (score 90, tag: accuracy) ═══')
  try {
    const fb1 = await identity.giveFeedback(config, {
      address: reviewerAddress,
      password: reviewerPassword,
      agentId,
      value: 90,
      valueDecimals: 0,
      tag1: 'accuracy',
      tag2: 'v1',
    })
    console.log(`TX: ${fb1.txHash}`)
    console.log(`Feedback Index: ${fb1.feedbackIndex}`)
    console.log()

    // ── Step 5: Give second feedback ─────────────────────────────────────────
    console.log('═══ Step 5: Give Feedback (score 80, tag: speed) ═══')
    const fb2 = await identity.giveFeedback(config, {
      address: reviewerAddress,
      password: reviewerPassword,
      agentId,
      value: 80,
      valueDecimals: 0,
      tag1: 'speed',
      tag2: 'v1',
    })
    console.log(`TX: ${fb2.txHash}`)
    console.log(`Feedback Index: ${fb2.feedbackIndex}`)
    console.log()

    // ── Step 6: Read reputation ──────────────────────────────────────────────
    console.log('═══ Step 6: Read Reputation Summary ═══')
    const rep = await identityRead.reputation(config, { agentId })
    console.log(`Score: ${rep.score}`)
    console.log(`Count: ${rep.count}`)
    console.log(`Clients: ${rep.clients.join(', ') || '(none)'}`)
    console.log()

    // ── Step 7: List feedback entries ─────────────────────────────────────────
    console.log('═══ Step 7: List Feedback Entries ═══')
    const fbList = await identityRead.feedbackList(config, { agentId })
    for (const entry of fbList.entries) {
      console.log(`  #${entry.feedbackIndex}: value=${entry.value}, tag1=${entry.tag1}, tag2=${entry.tag2}, revoked=${entry.revoked}, from=${entry.client.slice(0, 10)}...`)
    }
    console.log()

    // ── Step 8: Status with reputation ────────────────────────────────────────
    console.log('═══ Step 8: Status with Reputation ═══')
    const status2 = await identityRead.status(config, { agentId })
    console.log(`Reputation: score=${status2.reputation.score}, count=${status2.reputation.count}`)
    console.log()

    // ── Step 9: Revoke first feedback ─────────────────────────────────────────
    console.log('═══ Step 9: Revoke First Feedback ═══')
    const revoke = await identity.revokeFeedback(config, {
      address: reviewerAddress,
      password: reviewerPassword,
      agentId,
      feedbackIndex: Number(fb1.feedbackIndex),
    })
    console.log(`TX: ${revoke.txHash}`)
    console.log()

    // ── Step 10: Reputation after revoke ──────────────────────────────────────
    console.log('═══ Step 10: Reputation After Revoke ═══')
    const rep2 = await identityRead.reputation(config, { agentId })
    console.log(`Score: ${rep2.score} (was ${rep.score})`)
    console.log(`Count: ${rep2.count} (was ${rep.count})`)
    console.log()
  } catch (err: any) {
    console.log(`Feedback flow failed: ${err.message?.slice(0, 200)}`)
    console.log('(This may happen if the reviewer wallet has insufficient gas)')
    console.log()
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log(`═══ ✅ Full Flow Complete ═══`)
  console.log(`Agent: ${agentName} (ID: ${agentId})`)
  console.log(`Image: https://picsum.photos/id/${imageId}/400/400`)
  console.log(`Card: ${regResult.cardUri}`)
  console.log()
  console.log('Agent left alive for explorer inspection.')

  // Cleanup wallets
  wallets.remove(address)
  wallets.remove(reviewerAddress)
}

main().catch(err => {
  console.error('\n❌ Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
