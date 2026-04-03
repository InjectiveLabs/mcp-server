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
import { privateKeyToAccount } from 'viem/accounts'

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

    // Derive EVM address from the private key using viem
    const evmAccount = privateKeyToAccount(pk as `0x${string}`)
    testEvmAddress = evmAccount.address

    expect(testAddress).toMatch(/^inj1/)
    expect(testEvmAddress).toMatch(/^0x/)
  })

  it('registers an agent', async () => {
    const result = await identity.register(config, {
      address: testAddress,
      password: testPassword,
      name: 'IntegrationTestBot',
      type: 'trading',
      builderCode: 'test-builder',
      wallet: testEvmAddress,
    })

    expect(result.txHash).toMatch(TX_HASH_RE)
    expect(result.agentId).toBeDefined()
    // Self-link should succeed (wallet = own EVM address)
    expect(result.walletTxHash).toMatch(TX_HASH_RE)
    expect(result.walletLinkSkipped).toBeUndefined()
    agentId = result.agentId
  }, 60_000)

  it('reads agent status and verifies metadata decoding', async () => {
    const result = await identityRead.status(config, { agentId })

    expect(result.agentId).toBe(agentId)
    // name comes from getMetadata('name') decoded
    expect(result.name).toBe('IntegrationTestBot')
    // agentType is a string from getMetadata('agentType') decoded
    expect(result.agentType).toBe('trading')
    expect(result.builderCode).toBe('test-builder')
    expect(result.owner).toMatch(/^0x/)
    expect(result.linkedWallet.toLowerCase()).toBe(testEvmAddress.toLowerCase())
  }, 30_000)

  it('updates agent name via setMetadata', async () => {
    const result = await identity.update(config, {
      address: testAddress,
      password: testPassword,
      agentId,
      name: 'UpdatedTestBot',
    })

    expect(result.txHashes).toHaveLength(1)
    expect(result.txHashes[0]).toMatch(TX_HASH_RE)

    // Verify the update took effect
    const status = await identityRead.status(config, { agentId })
    expect(status.name).toBe('UpdatedTestBot')
  }, 60_000)

  it('lists agents and finds ours', async () => {
    const result = await identityRead.list(config, { limit: 50 })

    expect(result.agents.length).toBeGreaterThan(0)
    const found = result.agents.find(a => a.agentId === agentId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('UpdatedTestBot')
    expect(found!.agentType).toBe('trading')
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
