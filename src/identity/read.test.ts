import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { IdentityNotFound } from '../errors/index.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetEnrichedAgent = vi.fn()
const mockListAgents = vi.fn()
const mockGetAgentsByOwner = vi.fn()
const mockGetReputation = vi.fn()
const mockGetFeedbackEntries = vi.fn()

vi.mock('@injective/agent-sdk', () => ({
  AgentReadClient: vi.fn().mockImplementation(() => ({
    getEnrichedAgent: mockGetEnrichedAgent,
    listAgents: mockListAgents,
    getAgentsByOwner: mockGetAgentsByOwner,
    getReputation: mockGetReputation,
    getFeedbackEntries: mockGetFeedbackEntries,
    getClients: vi.fn().mockResolvedValue([]),
  })),
}))

vi.mock('../evm/index.js', () => ({
  evm: {
    injAddressToEth: vi.fn((inj: string) => {
      if (inj === 'inj1' + 'a'.repeat(38)) return '0x' + '11'.repeat(20)
      return '0x' + '99'.repeat(20)
    }),
  },
}))

import { identityRead } from './read.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const config = testConfig()
const AGENT_ID = '42'
const OWNER_ADDRESS = '0x' + 'ff'.repeat(20)
const LINKED_WALLET = '0x' + 'aa'.repeat(20)
const TOKEN_URI = 'https://example.com/agent/42.json'

// ─── identityRead.status ────────────────────────────────────────────────────

describe('identityRead.status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps SDK EnrichedAgentResult to MCP StatusResult', async () => {
    mockGetEnrichedAgent.mockResolvedValue({
      agentId: 42n,
      name: 'TestAgent',
      type: 'autonomous',
      builderCode: 'builder-xyz',
      owner: OWNER_ADDRESS,
      tokenUri: TOKEN_URI,
      wallet: LINKED_WALLET,
      reputation: { score: 85, count: 3 },
    })

    const result = await identityRead.status(config, { agentId: AGENT_ID })

    expect(result).toEqual({
      agentId: '42',
      name: 'TestAgent',
      agentType: 'autonomous',
      builderCode: 'builder-xyz',
      owner: OWNER_ADDRESS,
      tokenURI: TOKEN_URI,
      linkedWallet: LINKED_WALLET,
      reputation: {
        score: '85',
        count: '3',
      },
    })
  })

  it('converts reputation score/count to strings', async () => {
    mockGetEnrichedAgent.mockResolvedValue({
      agentId: 42n,
      name: 'BigRepAgent',
      type: 'trading',
      builderCode: 'b',
      owner: OWNER_ADDRESS,
      tokenUri: TOKEN_URI,
      wallet: LINKED_WALLET,
      reputation: { score: 4500, count: 10 },
    })

    const result = await identityRead.status(config, { agentId: AGENT_ID })

    expect(result.reputation.score).toBe('4500')
    expect(result.reputation.count).toBe('10')
    expect(typeof result.reputation.score).toBe('string')
    expect(typeof result.reputation.count).toBe('string')
  })

  it('throws IdentityNotFound on ERC721 error', async () => {
    mockGetEnrichedAgent.mockRejectedValue(new Error('ERC721: invalid token ID'))

    await expect(
      identityRead.status(config, { agentId: '999' }),
    ).rejects.toThrow(IdentityNotFound)

    await expect(
      identityRead.status(config, { agentId: '999' }),
    ).rejects.toThrow('Identity not found for agent: 999')
  })

  it('throws IdentityNotFound for nonexistent token error', async () => {
    mockGetEnrichedAgent.mockRejectedValue(new Error('query for nonexistent token'))

    await expect(
      identityRead.status(config, { agentId: '888' }),
    ).rejects.toThrow(IdentityNotFound)
  })

  it('throws IdentityNotFound for invalid token error', async () => {
    mockGetEnrichedAgent.mockRejectedValue(new Error('invalid token'))

    await expect(
      identityRead.status(config, { agentId: '777' }),
    ).rejects.toThrow(IdentityNotFound)
  })

  it('re-throws non-identity errors as-is', async () => {
    mockGetEnrichedAgent.mockRejectedValue(new Error('network timeout'))

    await expect(
      identityRead.status(config, { agentId: AGENT_ID }),
    ).rejects.toThrow('network timeout')

    await expect(
      identityRead.status(config, { agentId: AGENT_ID }),
    ).rejects.not.toThrow(IdentityNotFound)
  })
})

// ─── identityRead.list ──────────────────────────────────────────────────────

describe('identityRead.list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('without owner: calls sdk.listAgents()', async () => {
    mockListAgents.mockResolvedValue({
      agents: [
        { agentId: 1n, name: 'Agent1', type: 'trading', owner: OWNER_ADDRESS },
        { agentId: 2n, name: 'Agent2', type: 'analytics', owner: OWNER_ADDRESS },
      ],
    })

    const result = await identityRead.list(config, {})

    expect(mockListAgents).toHaveBeenCalledWith({ limit: 20 })
    expect(mockGetAgentsByOwner).not.toHaveBeenCalled()
    expect(result.agents).toHaveLength(2)
    expect(result.agents[0]).toEqual({
      agentId: '1',
      name: 'Agent1',
      agentType: 'trading',
      owner: OWNER_ADDRESS,
    })
  })

  it('with owner (inj1...): converts to 0x, calls sdk.getAgentsByOwner()', async () => {
    const injAddress = 'inj1' + 'a'.repeat(38)
    const convertedAddress = '0x' + '11'.repeat(20)

    mockGetAgentsByOwner.mockResolvedValue({
      agents: [
        { agentId: 10n, name: 'InjAgent', type: 'trading', owner: convertedAddress },
      ],
    })

    const result = await identityRead.list(config, { owner: injAddress })

    expect(mockGetAgentsByOwner).toHaveBeenCalledWith(convertedAddress, { limit: 20 })
    expect(mockListAgents).not.toHaveBeenCalled()
    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.agentId).toBe('10')
  })

  it('with 0x owner: calls sdk.getAgentsByOwner() directly', async () => {
    mockGetAgentsByOwner.mockResolvedValue({
      agents: [
        { agentId: 5n, name: 'EvmAgent', type: 'trading', owner: OWNER_ADDRESS },
      ],
    })

    const result = await identityRead.list(config, { owner: OWNER_ADDRESS })

    expect(mockGetAgentsByOwner).toHaveBeenCalledWith(OWNER_ADDRESS, { limit: 20 })
    expect(result.agents).toHaveLength(1)
  })

  it('with type filter: applies filter after fetch', async () => {
    mockListAgents.mockResolvedValue({
      agents: [
        { agentId: 1n, name: 'Agent1', type: 'trading', owner: OWNER_ADDRESS },
        { agentId: 2n, name: 'Agent2', type: 'analytics', owner: OWNER_ADDRESS },
        { agentId: 3n, name: 'Agent3', type: 'trading', owner: OWNER_ADDRESS },
      ],
    })

    const result = await identityRead.list(config, { type: 'trading' })

    expect(result.agents).toHaveLength(2)
    expect(result.agents.every((a) => a.agentType === 'trading')).toBe(true)
  })

  it('respects limit parameter', async () => {
    mockListAgents.mockResolvedValue({
      agents: [
        { agentId: 1n, name: 'Agent1', type: 'trading', owner: OWNER_ADDRESS },
        { agentId: 2n, name: 'Agent2', type: 'trading', owner: OWNER_ADDRESS },
        { agentId: 3n, name: 'Agent3', type: 'trading', owner: OWNER_ADDRESS },
      ],
    })

    const result = await identityRead.list(config, { limit: 2 })

    expect(result.agents).toHaveLength(2)
    expect(result.total).toBe(3)
  })

  it('returns empty array when no agents exist', async () => {
    mockListAgents.mockResolvedValue({ agents: [] })

    const result = await identityRead.list(config, {})

    expect(result.agents).toEqual([])
    expect(result.total).toBe(0)
  })

  it('over-fetches 3x when type filter is active', async () => {
    mockListAgents.mockResolvedValue({ agents: [] })

    await identityRead.list(config, { type: 'trading', limit: 5 })

    expect(mockListAgents).toHaveBeenCalledWith({ limit: 15 })
  })
})

// ─── identityRead.reputation ───────────────────────────────────────────────

describe('identityRead.reputation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns SDK reputation data with agentId as string', async () => {
    mockGetReputation.mockResolvedValue({
      score: 45,
      count: 5,
      clients: ['0x' + 'aa'.repeat(20), '0x' + 'bb'.repeat(20)],
    })

    const result = await identityRead.reputation(config, { agentId: AGENT_ID })

    expect(result).toEqual({
      agentId: '42',
      score: 45,
      count: 5,
      clients: ['0x' + 'aa'.repeat(20), '0x' + 'bb'.repeat(20)],
    })
    expect(mockGetReputation).toHaveBeenCalledWith(42n, {
      clientAddresses: undefined,
      tag1: undefined,
      tag2: undefined,
    })
  })

  it('passes filter params to SDK', async () => {
    mockGetReputation.mockResolvedValue({ score: 100, count: 1, clients: [] })

    const clientAddresses = ['0x' + 'cc'.repeat(20)]
    await identityRead.reputation(config, {
      agentId: AGENT_ID,
      clientAddresses,
      tag1: 'accuracy',
      tag2: 'v2',
    })

    expect(mockGetReputation).toHaveBeenCalledWith(42n, {
      clientAddresses,
      tag1: 'accuracy',
      tag2: 'v2',
    })
  })

  it('returns zeros on error', async () => {
    mockGetReputation.mockRejectedValue(new Error('execution reverted'))

    const result = await identityRead.reputation(config, { agentId: '999' })

    expect(result).toEqual({
      agentId: '999',
      score: 0,
      count: 0,
      clients: [],
    })
  })
})

// ─── identityRead.feedbackList ─────────────────────────────────────────────

describe('identityRead.feedbackList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps SDK entries (bigint values, tags tuple) to MCP entries', async () => {
    mockGetFeedbackEntries.mockResolvedValue([
      {
        client: '0x' + 'aa'.repeat(20),
        feedbackIndex: 0n,
        value: 500n,
        decimals: 2,
        tags: ['accuracy', 'v1'],
        revoked: false,
      },
      {
        client: '0x' + 'bb'.repeat(20),
        feedbackIndex: 1n,
        value: 300n,
        decimals: 1,
        tags: ['speed', 'v2'],
        revoked: false,
      },
    ])

    const result = await identityRead.feedbackList(config, { agentId: AGENT_ID })

    expect(result.agentId).toBe('42')
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toEqual({
      client: '0x' + 'aa'.repeat(20),
      feedbackIndex: 0,
      value: 5,
      tag1: 'accuracy',
      tag2: 'v1',
      revoked: false,
    })
    expect(result.entries[1]).toEqual({
      client: '0x' + 'bb'.repeat(20),
      feedbackIndex: 1,
      value: 30,
      tag1: 'speed',
      tag2: 'v2',
      revoked: false,
    })
  })

  it('normalizes values by decimals', async () => {
    mockGetFeedbackEntries.mockResolvedValue([
      {
        client: '0x' + 'aa'.repeat(20),
        feedbackIndex: 0n,
        value: 12345n,
        decimals: 3,
        tags: ['tag', ''],
        revoked: false,
      },
    ])

    const result = await identityRead.feedbackList(config, { agentId: AGENT_ID })

    expect(result.entries[0]!.value).toBeCloseTo(12.345, 3)
  })

  it('returns empty entries on error', async () => {
    mockGetFeedbackEntries.mockRejectedValue(new Error('execution reverted'))

    const result = await identityRead.feedbackList(config, { agentId: '999' })

    expect(result).toEqual({ agentId: '999', entries: [] })
  })

  it('passes filter params to SDK', async () => {
    mockGetFeedbackEntries.mockResolvedValue([])

    await identityRead.feedbackList(config, {
      agentId: AGENT_ID,
      clientAddresses: ['0x' + 'cc'.repeat(20)],
      tag1: 'accuracy',
      tag2: 'v2',
      includeRevoked: true,
    })

    expect(mockGetFeedbackEntries).toHaveBeenCalledWith(42n, {
      clientAddresses: ['0x' + 'cc'.repeat(20)],
      tag1: 'accuracy',
      tag2: 'v2',
      includeRevoked: true,
    })
  })
})
