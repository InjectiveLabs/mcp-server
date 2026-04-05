/**
 * End-to-end integration test: register an agent on testnet with full metadata,
 * give feedback, and fetch its reputation.
 *
 * This test hits real testnet contracts and IPFS.
 *
 * Run with:
 *   TEST_ADDRESS="inj1..." TEST_PASSWORD="..." PINATA_JWT="..." npm test -- integration.test.ts
 *
 * Requirements:
 *   - TEST_ADDRESS: A valid testnet Injective address (inj1...)
 *   - TEST_PASSWORD: Password for the keystore wallet
 *   - PINATA_JWT: Pinata API token for IPFS storage
 *   - Agent SDK must be built and installed
 *   - Sufficient testnet INJ for gas fees
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { wallets } from '../wallets/index.js'
import { evm } from '../evm/index.js'
import { identity } from './index.js'
import { identityRead } from './read.js'

// ─── Prerequisites Check ───────────────────────────────────────────────────

const TEST_ADDRESS = process.env['TEST_ADDRESS']
const TEST_PASSWORD = process.env['TEST_PASSWORD']
const PINATA_JWT = process.env['PINATA_JWT']

const SKIP_REASON = (() => {
  if (!TEST_ADDRESS) return 'TEST_ADDRESS not set'
  if (!TEST_PASSWORD) return 'TEST_PASSWORD not set'
  if (!PINATA_JWT) return 'PINATA_JWT not set'
  return null
})()

describe.skipIf(SKIP_REASON)('Identity Integration Tests (Testnet)', () => {
  const config = testConfig()
  let agentId: string
  let evmAddress: string  // EVM equivalent of TEST_ADDRESS, derived in beforeAll

  beforeAll(async () => {
    console.log(`\n🔐 Verifying wallet at ${TEST_ADDRESS}...`)
    wallets.unlock(TEST_ADDRESS!, TEST_PASSWORD!)
    evmAddress = evm.injAddressToEth(TEST_ADDRESS!)
    console.log('✅ Wallet unlocked successfully\n')
  })

  it('registers agent on testnet with full metadata', async () => {
    console.log('📝 Registering agent on testnet...')
    const ts = Date.now()

    const result = await identity.register(config, {
      address: TEST_ADDRESS!,
      password: TEST_PASSWORD!,
      name: 'E2E Test Agent ' + ts,
      type: 'trading',
      builderCode: 'e2e-test-' + ts,
      description: 'Full end-to-end test agent with metadata, image, and services',
      image: 'https://picsum.photos/256?random=' + ts,
      services: [
        {
          name: 'trading',
          endpoint: 'https://api.test.com/trade',
          description: 'Test trading service',
        },
        {
          name: 'analytics',
          endpoint: 'https://api.test.com/analytics',
          description: 'Test analytics service',
        },
      ],
    })

    console.log('✅ Agent registered!')
    console.log(`   • Agent ID: ${result.agentId}`)
    console.log(`   • TX Hash: ${result.txHash}`)
    console.log(`   • Card URI: ${result.cardUri}`)
    console.log(`   • Owner: ${result.owner}\n`)

    agentId = result.agentId

    expect(result.agentId).toBeDefined()
    expect(result.txHash).toBeDefined()
    expect(result.cardUri).toBeDefined()
    expect(result.owner).toBe(result.evmAddress)
    expect(result.owner).toMatch(/^0x[a-fA-F0-9]{40}$/)
  }, 120000)

  it('fetches registered agent status with metadata', async () => {
    console.log('📊 Fetching agent status from testnet...')

    const result = await identityRead.status(config, { agentId })

    console.log('✅ Status fetched!')
    console.log(`   • Name: ${result.name}`)
    console.log(`   • Type: ${result.agentType}`)
    console.log(`   • Token URI: ${result.tokenURI}`)
    console.log(`   • Reputation: ${result.reputation.score}/${result.reputation.count}\n`)

    expect(result.agentId).toBe(agentId)
    expect(result.name).toBeDefined()
    expect(result.agentType).toBe('trading')
    expect(result.builderCode).toBeDefined()
    expect(result.owner).toBeDefined()
    expect(result.tokenURI).toBeDefined()
    expect(result.reputation).toEqual({
      score: expect.any(String),
      count: expect.any(String),
    })
  }, 60000)

  it('lists agents by owner', async () => {
    console.log('📋 Listing agents by owner...')

    const result = await identityRead.list(config, {
      owner: TEST_ADDRESS!,
      limit: 5,
    })

    console.log(`✅ Found ${result.agents.length} agents\n`)

    expect(Array.isArray(result.agents)).toBe(true)
    expect(result.total).toBeGreaterThanOrEqual(result.agents.length)

    const newAgent = result.agents.find((a) => a.agentId === agentId)
    expect(newAgent).toBeDefined()
    expect(newAgent?.name).toBeDefined()
  }, 60000)

  it('gives feedback on the agent', async () => {
    console.log('⭐ Giving feedback on agent...')

    const result = await identity.giveFeedback(config, {
      address: TEST_ADDRESS!,
      password: TEST_PASSWORD!,
      agentId,
      value: 85,
      tag1: 'accuracy',
      tag2: 'e2e-test',
    })

    console.log('✅ Feedback given!')
    console.log(`   • TX Hash: ${result.txHash}`)
    console.log(`   • Feedback Index: ${result.feedbackIndex}\n`)

    expect(result.txHash).toBeDefined()
    expect(result.agentId).toBe(agentId)
    expect(result.feedbackIndex).toBeDefined()
  }, 120000)

  it('fetches agent reputation after feedback', async () => {
    console.log('📈 Fetching updated reputation...')

    const result = await identityRead.reputation(config, {
      agentId,
      clientAddresses: [evmAddress],  // rep.clients contains 0x addresses
    })

    console.log('✅ Reputation updated!')
    console.log(`   • Score: ${result.score}`)
    console.log(`   • Count: ${result.count}`)
    console.log(`   • Clients: ${result.clients.length}\n`)

    expect(result.agentId).toBe(agentId)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.count).toBeGreaterThanOrEqual(1)
    expect(result.clients).toContain(evmAddress)
  }, 60000)

  it('lists feedback entries for the agent', async () => {
    console.log('📝 Listing feedback entries...')

    const result = await identityRead.feedbackList(config, {
      agentId,
      clientAddresses: [evmAddress],  // entries use 0x addresses
    })

    console.log(`✅ Found ${result.entries.length} feedback entries\n`)

    expect(result.agentId).toBe(agentId)
    expect(Array.isArray(result.entries)).toBe(true)

    const ourFeedback = result.entries.find((e) => e.client === evmAddress)
    expect(ourFeedback).toBeDefined()
    expect(ourFeedback?.value).toBeCloseTo(85, 1)
    expect(ourFeedback?.tag1).toBe('accuracy')
    expect(ourFeedback?.tag2).toBe('e2e-test')
  }, 60000)
})
