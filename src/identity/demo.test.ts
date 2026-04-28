/**
 * End-to-end demo: register an agent with full metadata, then fetch its status with reputation.
 *
 * This is a Vitest test file demonstrating the full identity workflow with mocked SDK.
 *
 * Run with:
 *   npm test -- src/identity/demo.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'

// ─── Mocks (same as identity.test.ts) ──────────────────────────────────────

const mockRegister = vi.fn()
const mockGetStatus = vi.fn()
const mockGetEnrichedAgent = vi.fn()

vi.mock('@injective/agent-sdk', () => ({
  AgentClient: vi.fn().mockImplementation(() => ({
    address: '0x' + 'ab'.repeat(20),
    injAddress: 'inj1' + 'a'.repeat(38),
    register: mockRegister,
    getStatus: mockGetStatus,
  })),
  PinataStorage: vi.fn(),
  AgentReadClient: vi.fn().mockImplementation(() => ({
    getEnrichedAgent: mockGetEnrichedAgent,
  })),
}))

vi.mock('../wallets/index.js', () => ({
  wallets: { unlock: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)) },
}))

import { identity } from './index.js'
import { identityRead } from './read.js'

// ─── Test ─────────────────────────────────────────────────────────────────

describe('Identity Workflow Demo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['PINATA_JWT'] = 'mock-jwt'
  })

  it('registers agent with full metadata and fetches status with reputation', async () => {
    const config = testConfig()
    const SIGNER_ADDRESS = '0x' + 'ab'.repeat(20)
    const AGENT_ID = '42'
    const IMAGE_URL = 'https://picsum.photos/256?random=1'

    // Mock registration response
    mockRegister.mockResolvedValue({
      agentId: 42n,
      cardUri: 'ipfs://QmFullMetadataCard123',
      txHashes: ['0x' + 'dd'.repeat(32)],
    })

    // Mock status response
    mockGetEnrichedAgent.mockResolvedValue({
      agentId: 42n,
      name: 'Demo Trading Agent',
      type: 'trading',
      builderCode: 'builder-demo-2026',
      owner: SIGNER_ADDRESS,
      tokenUri: 'ipfs://QmFullMetadataCard123',
      wallet: SIGNER_ADDRESS,
      reputation: { score: 0, count: 0 },
    })

    // ─── Step 1: Register ─────────────────────────────────────────────

    console.log('\n🚀 Registering agent with full metadata...')

    const registerResult = await identity.register(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      name: 'Demo Trading Agent',
      type: 'trading',
      builderCode: 'builder-demo-2026',
      description: 'A fully-featured agent demonstrating metadata, image, and services',
      image: IMAGE_URL,
      services: [
        {
          name: 'trading',
          endpoint: 'https://api.demo.com/trade',
          description: 'Executes trades on behalf of clients',
        },
        {
          name: 'analytics',
          endpoint: 'https://api.demo.com/analytics',
          description: 'Provides performance analytics and reports',
        },
      ],
    })

    console.log('✅ Registration successful!')
    console.log(`   • Agent ID: ${registerResult.agentId}`)
    console.log(`   • EVM Address: ${registerResult.evmAddress}`)
    console.log(`   • Card URI: ${registerResult.cardUri}`)

    expect(registerResult.agentId).toBe(AGENT_ID)
    expect(registerResult.owner).toBe(SIGNER_ADDRESS)
    expect(registerResult.evmAddress).toBe(SIGNER_ADDRESS)
    expect(registerResult.cardUri).toBe('ipfs://QmFullMetadataCard123')

    // Verify SDK was called with all metadata
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Demo Trading Agent',
        type: 'trading',
        builderCode: 'builder-demo-2026',
        description: 'A fully-featured agent demonstrating metadata, image, and services',
        image: IMAGE_URL,
        services: expect.arrayContaining([
          expect.objectContaining({ name: 'trading' }),
          expect.objectContaining({ name: 'analytics' }),
        ]),
      }),
    )

    // ─── Step 2: Fetch Status ─────────────────────────────────────────

    console.log('\n📊 Fetching agent status with reputation...')

    const statusResult = await identityRead.status(config, { agentId: AGENT_ID })

    console.log('✅ Status fetched successfully!')
    console.log(`   • Name: ${statusResult.name}`)
    console.log(`   • Type: ${statusResult.agentType}`)
    console.log(`   • Builder Code: ${statusResult.builderCode}`)
    console.log(`   • Reputation Score: ${statusResult.reputation.score}`)
    console.log(`   • Reputation Count: ${statusResult.reputation.count}`)

    expect(statusResult.agentId).toBe(AGENT_ID)
    expect(statusResult.name).toBe('Demo Trading Agent')
    expect(statusResult.agentType).toBe('trading')
    expect(statusResult.builderCode).toBe('builder-demo-2026')
    expect(statusResult.reputation).toEqual({ score: '0', count: '0' })

    // ─── Summary ──────────────────────────────────────────────────────

    console.log('\n✨ Demo complete!')
    console.log('Agent successfully registered and status verified.\n')
  })
})
