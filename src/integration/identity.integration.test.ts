/**
 * Identity integration tests -- register, query, update, and deregister an
 * ERC-8004 agent identity on the real Injective EVM testnet.
 *
 * Prerequisites:
 *   INJECTIVE_PRIVATE_KEY  -- hex private key (0x-prefixed or bare)
 *   INJECTIVE_NETWORK      -- 'mainnet' | 'testnet' (defaults to 'testnet')
 *
 * Run:
 *   INJECTIVE_PRIVATE_KEY=0x... npm run test:integration
 *
 * These tests mutate on-chain state (register / update / deregister).
 * They run sequentially so each step can use the previous step's result.
 */
import { describe, it, expect } from 'vitest'
import { getEthereumAddress } from '@injectivelabs/sdk-ts'

import { createConfig } from '../config/index.js'
import { identity } from '../identity/index.js'
import { identityRead } from '../identity/read.js'
import { wallets } from '../wallets/index.js'
import { getTestPrivateKey, getTestNetwork, TX_HASH_RE } from '../test-utils/index.js'

// ---- Setup -----------------------------------------------------------------

const network = getTestNetwork()
const config = createConfig(network)

describe('identity integration', () => {
  const testPassword = 'integration-test-password-8004'
  let testAddress: string
  let testEvmAddress: string
  let agentId: string

  it('sets up test wallet', () => {
    const pk = getTestPrivateKey()
    const importResult = wallets.import(pk, testPassword, 'identity-integration-test')
    testAddress = importResult.address
    testEvmAddress = getEthereumAddress(testAddress)
    expect(testAddress).toMatch(/^inj1/)
    expect(testEvmAddress).toMatch(/^0x/)
  })

  it('registers an agent', async () => {
    const result = await identity.register(config, {
      address: testAddress,
      password: testPassword,
      name: 'IntegrationTestBot',
      type: 1,
      builderCode: '0x' + '00'.repeat(31) + '01',
      wallet: testEvmAddress,
      uri: '',
    })

    expect(result.txHash).toMatch(TX_HASH_RE)
    expect(result.agentId).toBeDefined()
    agentId = result.agentId
  }, 60_000)

  it('reads agent status', async () => {
    const result = await identityRead.status(config, { agentId })

    expect(result.agentId).toBe(agentId)
    expect(result.name).toBe('IntegrationTestBot')
    expect(result.agentType).toBe(1)
    expect(result.owner).toMatch(/^0x/)
  }, 30_000)

  it('updates agent name', async () => {
    const result = await identity.update(config, {
      address: testAddress,
      password: testPassword,
      agentId,
      name: 'UpdatedTestBot',
    })

    expect(result.txHashes).toHaveLength(1)
    expect(result.txHashes[0]).toMatch(TX_HASH_RE)
  }, 60_000)

  it('lists agents (includes our agent)', async () => {
    const result = await identityRead.list(config, { limit: 50 })

    expect(result.agents.length).toBeGreaterThan(0)
    const found = result.agents.find(a => a.agentId === agentId)
    expect(found).toBeDefined()
  }, 60_000)

  it('deregisters the agent', async () => {
    const result = await identity.deregister(config, {
      address: testAddress,
      password: testPassword,
      agentId,
      confirm: true,
    })

    expect(result.txHash).toMatch(TX_HASH_RE)
  }, 60_000)

  it('cleans up test wallet', () => {
    wallets.remove(testAddress)
  })
})
