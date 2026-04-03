import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateAgentCard, fetchAgentCard, mergeAgentCard, validateImageUrl } from './card.js'
import type { AgentCard } from './types.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('generateAgentCard', () => {
  it('builds a valid agent card with all fields', () => {
    const card = generateAgentCard({
      name: 'TradeBot', agentType: 'trading', builderCode: 'acme-001',
      operatorAddress: '0xabc', chainId: 1439,
      description: 'An automated trading agent',
      image: 'https://example.com/bot.png',
      services: [{ type: 'mcp', url: 'https://mcp.example.com' }],
    })
    expect(card.name).toBe('TradeBot')
    expect(card.description).toBe('An automated trading agent')
    expect(card.image).toBe('https://example.com/bot.png')
    expect(card.services).toHaveLength(1)
    expect(card.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1')
    expect(card.metadata.chain).toBe('injective')
    expect(card.metadata.chainId).toBe('1439')
    expect(card.metadata.agentType).toBe('trading')
    expect(card.metadata.builderCode).toBe('acme-001')
    expect(card.metadata.operatorAddress).toBe('0xabc')
    expect(card.x402Support).toBe(false)
  })

  it('omits description when not provided', () => {
    const card = generateAgentCard({
      name: 'Bot', agentType: 'trading', builderCode: 'x',
      operatorAddress: '0x1', chainId: 1439,
    })
    expect(card.description).toBeUndefined()
  })

  it('defaults image to empty string', () => {
    const card = generateAgentCard({
      name: 'Bot', agentType: 'trading', builderCode: 'x',
      operatorAddress: '0x1', chainId: 1439,
    })
    expect(card.image).toBe('')
  })

  it('defaults services to empty array', () => {
    const card = generateAgentCard({
      name: 'Bot', agentType: 'trading', builderCode: 'x',
      operatorAddress: '0x1', chainId: 1439,
    })
    expect(card.services).toEqual([])
  })

  it('rejects invalid image URL', () => {
    expect(() => generateAgentCard({
      name: 'Bot', agentType: 'trading', builderCode: 'x',
      operatorAddress: '0x1', chainId: 1439, image: '/local/path.png',
    })).toThrow('Image must be a URL')
  })
})

describe('validateImageUrl', () => {
  it('accepts https URL', () => expect(() => validateImageUrl('https://example.com/img.png')).not.toThrow())
  it('accepts http URL', () => expect(() => validateImageUrl('http://example.com/img.png')).not.toThrow())
  it('accepts ipfs:// URL', () => expect(() => validateImageUrl('ipfs://QmTest')).not.toThrow())
  it('accepts empty string', () => expect(() => validateImageUrl('')).not.toThrow())
  it('rejects local file paths', () => expect(() => validateImageUrl('/tmp/img.png')).toThrow('Image must be a URL'))
  it('rejects relative paths', () => expect(() => validateImageUrl('images/bot.png')).toThrow('Image must be a URL'))
})

describe('fetchAgentCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches card from IPFS gateway', async () => {
    const mockCard: AgentCard = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Bot', image: '',
      services: [], x402Support: false,
      metadata: { chain: 'injective', chainId: '1439', agentType: 'trading', builderCode: 'x', operatorAddress: '0x1' },
    }
    mockFetch.mockResolvedValue({ ok: true, json: async () => mockCard })
    const card = await fetchAgentCard('ipfs://QmTest', 'https://w3s.link/ipfs/')
    expect(card).toEqual(mockCard)
    expect(mockFetch).toHaveBeenCalledWith('https://w3s.link/ipfs/QmTest', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('fetches from https:// URI directly', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ name: 'Bot' }) })
    await fetchAgentCard('https://example.com/card.json', 'https://w3s.link/ipfs/')
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/card.json', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('returns null on fetch failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' })
    expect(await fetchAgentCard('ipfs://QmBad', 'https://w3s.link/ipfs/')).toBeNull()
  })

  it('returns null for empty URI', async () => {
    expect(await fetchAgentCard('', 'https://w3s.link/ipfs/')).toBeNull()
  })

  it('throws on network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    await expect(fetchAgentCard('ipfs://QmTest', 'https://w3s.link/ipfs/')).rejects.toThrow('timeout')
  })
})

describe('mergeAgentCard', () => {
  const base: AgentCard = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Bot', description: 'Old desc',
    image: 'https://old.png', services: [{ type: 'mcp', url: 'https://mcp.old' }],
    x402Support: false,
    metadata: { chain: 'injective', chainId: '1439', agentType: 'trading', builderCode: 'x', operatorAddress: '0x1' },
  }

  it('updates image only', () => {
    const merged = mergeAgentCard(base, { image: 'https://new.png' })
    expect(merged.image).toBe('https://new.png')
    expect(merged.description).toBe('Old desc')
  })

  it('updates description only', () => {
    const merged = mergeAgentCard(base, { description: 'New desc' })
    expect(merged.description).toBe('New desc')
    expect(merged.image).toBe('https://old.png')
  })

  it('replaces services', () => {
    const merged = mergeAgentCard(base, { services: [{ type: 'rest', url: 'https://api.new' }] })
    expect(merged.services).toEqual([{ type: 'rest', url: 'https://api.new' }])
  })

  it('removes services by type', () => {
    const merged = mergeAgentCard(base, { removeServices: ['mcp'] })
    expect(merged.services).toEqual([])
  })

  it('updates name', () => {
    const merged = mergeAgentCard(base, { name: 'NewBot' })
    expect(merged.name).toBe('NewBot')
  })

  it('does not mutate original', () => {
    mergeAgentCard(base, { name: 'NewBot' })
    expect(base.name).toBe('Bot')
  })

  it('rejects invalid image in updates', () => {
    expect(() => mergeAgentCard(base, { image: '/local/path' })).toThrow('Image must be a URL')
  })
})
