import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { IdentityNotFound } from '../errors/index.js'
import { encodeStringMetadata } from './helpers.js'

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
const TOKEN_URI = 'https://example.com/agent/42.json'
const REPUTATION_COUNT = 3n
const REPUTATION_VALUE = 850n
const REPUTATION_DECIMALS = 1

// Pre-encoded metadata values
const ENCODED_NAME = encodeStringMetadata('TestAgent')
const ENCODED_BUILDER_CODE = encodeStringMetadata('builder-xyz')
const ENCODED_AGENT_TYPE = encodeStringMetadata('autonomous')

// ─── identityRead.status ────────────────────────────────────────────────────

describe('identityRead.status', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock the 7 readContract calls in sequence:
    // 1. getMetadata(id, 'name') → encoded name bytes
    // 2. getMetadata(id, 'builderCode') → encoded builderCode bytes
    // 3. getMetadata(id, 'agentType') → encoded agentType bytes
    // 4. ownerOf → owner address
    // 5. tokenURI → URI string
    // 6. getAgentWallet → wallet address
    // 7. getSummary → [count, summaryValue, summaryValueDecimals]
    mockReadContract
      .mockResolvedValueOnce(ENCODED_NAME)
      .mockResolvedValueOnce(ENCODED_BUILDER_CODE)
      .mockResolvedValueOnce(ENCODED_AGENT_TYPE)
      .mockResolvedValueOnce(OWNER_ADDRESS)
      .mockResolvedValueOnce(TOKEN_URI)
      .mockResolvedValueOnce(LINKED_WALLET)
      .mockResolvedValueOnce([REPUTATION_COUNT, REPUTATION_VALUE, REPUTATION_DECIMALS])
  })

  it('returns full agent details including reputation', async () => {
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

  it('returns getSummary reputation values as strings', async () => {
    // Use specific values to verify decimal conversion
    mockReadContract.mockReset()
    mockReadContract
      .mockResolvedValueOnce(encodeStringMetadata('BigRepAgent'))
      .mockResolvedValueOnce(ENCODED_BUILDER_CODE)
      .mockResolvedValueOnce(ENCODED_AGENT_TYPE)
      .mockResolvedValueOnce(OWNER_ADDRESS)
      .mockResolvedValueOnce(TOKEN_URI)
      .mockResolvedValueOnce(LINKED_WALLET)
      .mockResolvedValueOnce([10n, 4500n, 2])

    const result = await identityRead.status(config, { agentId: AGENT_ID })

    expect(result.reputation.score).toBe('45')
    expect(result.reputation.count).toBe('10')
    expect(typeof result.reputation.score).toBe('string')
    expect(typeof result.reputation.count).toBe('string')
  })

  it('decodes empty metadata as empty string', async () => {
    mockReadContract.mockReset()
    mockReadContract
      .mockResolvedValueOnce('0x') // name → empty
      .mockResolvedValueOnce('0x') // builderCode → empty
      .mockResolvedValueOnce('0x') // agentType → empty
      .mockResolvedValueOnce(OWNER_ADDRESS)
      .mockResolvedValueOnce(TOKEN_URI)
      .mockResolvedValueOnce(LINKED_WALLET)
      .mockResolvedValueOnce([0n, 0n, 0])

    const result = await identityRead.status(config, { agentId: AGENT_ID })

    expect(result.name).toBe('')
    expect(result.builderCode).toBe('')
    expect(result.agentType).toBe('')
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

    // Default readContract mock: per-key getMetadata + ownerOf for each token
    mockReadContract.mockImplementation(async (call: { functionName: string; args: unknown[] }) => {
      const id = Number(call.args[0])
      if (call.functionName === 'getMetadata') {
        const key = call.args[1] as string
        if (key === 'name') return encodeStringMetadata(`Agent${id}`)
        if (key === 'agentType') {
          const types = ['typeC', 'typeA', 'typeB']
          return encodeStringMetadata(types[id % 3]!)
        }
        return '0x'
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
      agentType: 'typeA',
      owner: OWNER_ADDRESS,
    })
  })

  it('filters by agent type', async () => {
    // Agent1 has typeA, Agent2 has typeB, Agent3 has typeC
    const result = await identityRead.list(config, { type: 'typeA' })

    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.agentId).toBe('1')
    expect(result.agents[0]!.agentType).toBe('typeA')
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
    mockReadContract.mockImplementation(async (call: { functionName: string; args: unknown[] }) => {
      const id = Number(call.args[0])
      if (id === 2) throw new Error('ERC721: invalid token ID')
      if (call.functionName === 'getMetadata') {
        const key = call.args[1] as string
        if (key === 'name') return encodeStringMetadata(`Agent${id}`)
        if (key === 'agentType') return encodeStringMetadata('typeA')
        return '0x'
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

    mockReadContract.mockImplementation(async (call: { functionName: string; args: unknown[] }) => {
      if (call.functionName === 'getMetadata') {
        const key = call.args[1] as string
        if (key === 'name') return encodeStringMetadata('InjAgent')
        if (key === 'agentType') return encodeStringMetadata('typeA')
        return '0x'
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

    mockReadContract.mockImplementation(async (call: { functionName: string; args: unknown[] }) => {
      const id = Number(call.args[0])
      if (call.functionName === 'getMetadata') {
        const key = call.args[1] as string
        if (key === 'name') return encodeStringMetadata(`Agent${id}`)
        if (key === 'agentType') return encodeStringMetadata('typeA')
        return '0x'
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
