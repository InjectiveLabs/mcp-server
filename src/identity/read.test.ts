import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { IdentityNotFound } from '../errors/index.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockReadContract = vi.fn()
const mockGetLogs = vi.fn()

vi.mock('./client.js', () => ({
  createIdentityPublicClient: vi.fn(() => ({
    readContract: mockReadContract,
    getLogs: mockGetLogs,
  })),
}))

vi.mock('@injectivelabs/sdk-ts', () => ({
  getEthereumAddress: vi.fn((inj: string) => {
    // Deterministic mock conversion: inj1... → 0x...
    if (inj === 'inj1' + 'a'.repeat(38)) return '0x' + '11'.repeat(20)
    return '0x' + '99'.repeat(20)
  }),
}))

import { identityRead } from './read.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const config = testConfig()
const AGENT_ID = '42'
const OWNER_ADDRESS = '0x' + 'ff'.repeat(20)
const LINKED_WALLET = '0x' + 'aa'.repeat(20)
const BUILDER_CODE = '0x' + 'cc'.repeat(32)
const TOKEN_URI = 'https://example.com/agent/42.json'
const REPUTATION_SCORE = 9500n
const FEEDBACK_COUNT = 120n

// ─── identityRead.status ────────────────────────────────────────────────────

describe('identityRead.status', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock the 5 readContract calls in sequence:
    // 1. getMetadata → [name, agentType, builderCode]
    // 2. ownerOf → owner address
    // 3. tokenURI → URI string
    // 4. getLinkedWallet → wallet address
    // 5. getReputation → [score, feedbackCount]
    mockReadContract
      .mockResolvedValueOnce(['TestAgent', 1, BUILDER_CODE])
      .mockResolvedValueOnce(OWNER_ADDRESS)
      .mockResolvedValueOnce(TOKEN_URI)
      .mockResolvedValueOnce(LINKED_WALLET)
      .mockResolvedValueOnce([REPUTATION_SCORE, FEEDBACK_COUNT])
  })

  it('returns full agent details including reputation', async () => {
    const result = await identityRead.status(config, { agentId: AGENT_ID })

    expect(result).toEqual({
      agentId: '42',
      name: 'TestAgent',
      agentType: 1,
      builderCode: BUILDER_CODE,
      owner: OWNER_ADDRESS,
      tokenURI: TOKEN_URI,
      linkedWallet: LINKED_WALLET,
      reputation: {
        score: '9500',
        feedbackCount: '120',
      },
    })
  })

  it('returns bigint reputation values as strings', async () => {
    // Use very large bigint values to verify string conversion
    mockReadContract.mockReset()
    mockReadContract
      .mockResolvedValueOnce(['BigRepAgent', 2, BUILDER_CODE])
      .mockResolvedValueOnce(OWNER_ADDRESS)
      .mockResolvedValueOnce(TOKEN_URI)
      .mockResolvedValueOnce(LINKED_WALLET)
      .mockResolvedValueOnce([999999999999999999n, 1000000000000n])

    const result = await identityRead.status(config, { agentId: AGENT_ID })

    expect(result.reputation.score).toBe('999999999999999999')
    expect(result.reputation.feedbackCount).toBe('1000000000000')
    expect(typeof result.reputation.score).toBe('string')
    expect(typeof result.reputation.feedbackCount).toBe('string')
  })

  it('throws IdentityNotFound when readContract fails with ERC721 error', async () => {
    mockReadContract.mockReset()
    mockReadContract.mockRejectedValue(new Error('ERC721: invalid token ID'))

    await expect(
      identityRead.status(config, { agentId: '999' }),
    ).rejects.toThrow(IdentityNotFound)

    await expect(
      identityRead.status(config, { agentId: '999' }),
    ).rejects.toThrow('Identity not found for agent: 999')
  })

  it('throws IdentityNotFound for nonexistent token error', async () => {
    mockReadContract.mockReset()
    mockReadContract.mockRejectedValue(new Error('query for nonexistent token'))

    await expect(
      identityRead.status(config, { agentId: '888' }),
    ).rejects.toThrow(IdentityNotFound)
  })

  it('throws IdentityNotFound for invalid token error', async () => {
    mockReadContract.mockReset()
    mockReadContract.mockRejectedValue(new Error('invalid token'))

    await expect(
      identityRead.status(config, { agentId: '777' }),
    ).rejects.toThrow(IdentityNotFound)
  })

  it('re-throws non-identity errors as-is', async () => {
    mockReadContract.mockReset()
    const networkErr = new Error('network timeout')
    mockReadContract.mockRejectedValue(networkErr)

    await expect(
      identityRead.status(config, { agentId: AGENT_ID }),
    ).rejects.toThrow('network timeout')

    await expect(
      identityRead.status(config, { agentId: AGENT_ID }),
    ).rejects.not.toThrow(IdentityNotFound)
  })
})

// ─── identityRead.list ──────────────────────────────────────────────────────

function makeMintLog(tokenId: bigint, to: string) {
  return {
    args: {
      from: '0x0000000000000000000000000000000000000000',
      to,
      tokenId,
    },
  }
}

describe('identityRead.list', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: 3 mint events
    mockGetLogs.mockResolvedValue([
      makeMintLog(1n, OWNER_ADDRESS),
      makeMintLog(2n, OWNER_ADDRESS),
      makeMintLog(3n, '0x' + 'bb'.repeat(20)),
    ])

    // Default readContract mock: getMetadata + ownerOf for each token
    mockReadContract.mockImplementation(async (call: { functionName: string; args: [bigint] }) => {
      const id = Number(call.args[0])
      if (call.functionName === 'getMetadata') {
        return [`Agent${id}`, id % 3, '0x' + '00'.repeat(32)]
      }
      if (call.functionName === 'ownerOf') {
        return id <= 2 ? OWNER_ADDRESS : '0x' + 'bb'.repeat(20)
      }
      return undefined
    })
  })

  it('returns agents from mint events', async () => {
    const result = await identityRead.list(config, {})

    expect(result.agents).toHaveLength(3)
    expect(result.total).toBe(3)
    expect(result.agents[0]).toEqual({
      agentId: '1',
      name: 'Agent1',
      agentType: 1,
      owner: OWNER_ADDRESS,
    })
  })

  it('filters by agent type', async () => {
    // Agent1 has type 1, Agent2 has type 2, Agent3 has type 0
    const result = await identityRead.list(config, { type: 1 })

    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.agentId).toBe('1')
    expect(result.agents[0]!.agentType).toBe(1)
  })

  it('filters by owner address', async () => {
    const otherOwner = '0x' + 'bb'.repeat(20)
    const result = await identityRead.list(config, { owner: otherOwner })

    // Only log with tokenId=3 has to=otherOwner
    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.agentId).toBe('3')
    expect(result.agents[0]!.owner).toBe(otherOwner)
  })

  it('respects limit parameter', async () => {
    const result = await identityRead.list(config, { limit: 2 })

    // Should only process the first 2 mint events
    expect(result.agents).toHaveLength(2)
    expect(result.total).toBe(2)
    expect(result.agents[0]!.agentId).toBe('1')
    expect(result.agents[1]!.agentId).toBe('2')
  })

  it('skips burned agents when readContract throws', async () => {
    // Token 2 is burned (readContract reverts)
    mockReadContract.mockImplementation(async (call: { functionName: string; args: [bigint] }) => {
      const id = Number(call.args[0])
      if (id === 2) throw new Error('ERC721: invalid token ID')
      if (call.functionName === 'getMetadata') {
        return [`Agent${id}`, 1, '0x' + '00'.repeat(32)]
      }
      if (call.functionName === 'ownerOf') {
        return OWNER_ADDRESS
      }
      return undefined
    })

    const result = await identityRead.list(config, {})

    // Should have 2 agents (1 and 3), token 2 skipped
    expect(result.agents).toHaveLength(2)
    expect(result.agents.map((a) => a.agentId)).toEqual(['1', '3'])
  })

  it('handles inj1... owner address conversion', async () => {
    const injAddress = 'inj1' + 'a'.repeat(38)
    const convertedAddress = '0x' + '11'.repeat(20)

    // Set up logs where one matches the converted address
    mockGetLogs.mockResolvedValue([
      makeMintLog(10n, convertedAddress),
      makeMintLog(11n, '0x' + 'dd'.repeat(20)),
    ])

    mockReadContract.mockImplementation(async (call: { functionName: string; args: [bigint] }) => {
      if (call.functionName === 'getMetadata') {
        return ['InjAgent', 1, '0x' + '00'.repeat(32)]
      }
      if (call.functionName === 'ownerOf') {
        return convertedAddress
      }
      return undefined
    })

    const result = await identityRead.list(config, { owner: injAddress })

    // Should filter logs by the converted 0x address
    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.agentId).toBe('10')
  })

  it('defaults limit to 20', async () => {
    // Create 25 mint logs
    const manyLogs = Array.from({ length: 25 }, (_, i) =>
      makeMintLog(BigInt(i + 1), OWNER_ADDRESS),
    )
    mockGetLogs.mockResolvedValue(manyLogs)

    mockReadContract.mockImplementation(async (call: { functionName: string; args: [bigint] }) => {
      const id = Number(call.args[0])
      if (call.functionName === 'getMetadata') {
        return [`Agent${id}`, 0, '0x' + '00'.repeat(32)]
      }
      if (call.functionName === 'ownerOf') {
        return OWNER_ADDRESS
      }
      return undefined
    })

    const result = await identityRead.list(config, {})

    // Default limit is 20
    expect(result.agents).toHaveLength(20)
  })

  it('returns empty array when no mint events exist', async () => {
    mockGetLogs.mockResolvedValue([])

    const result = await identityRead.list(config, {})

    expect(result.agents).toEqual([])
    expect(result.total).toBe(0)
  })
})
