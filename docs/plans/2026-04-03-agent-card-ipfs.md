# Agent Card Generation & IPFS Storage — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add agent card JSON generation, Pinata IPFS upload, and image URL handling so `agent_register` and `agent_update` produce fully displayable agents on 8004scan.io in a single call.

**Architecture:** Three new files in `src/identity/`: `types.ts` (AgentCard, ServiceEntry interfaces), `storage.ts` (PinataStorage class for IPFS uploads), `card.ts` (generateAgentCard, fetchAgentCard, mergeAgentCard). The register handler gains a card-build-upload step before the on-chain call. The update handler gains a fetch-merge-reupload step for card-level changes. When `uri` is provided directly, all card/IPFS logic is bypassed.

**Tech Stack:** Pinata REST API (`/pinning/pinJSONToIPFS`), viem (existing), vitest, zod 3.x

**PRD:** PRD-ecosystem-growth-2026-024

---

## Task 1: Create `identity/types.ts` — Agent Card Interfaces

**Files:**
- Create: `src/identity/types.ts`

No tests needed — pure type definitions.

**Step 1: Create types file**

```typescript
// src/identity/types.ts

export interface ServiceEntry {
  type: 'a2a' | 'mcp' | 'rest' | 'grpc' | 'webhook' | 'custom'
  url: string
  description?: string
}

export interface AgentCardMetadata {
  chain: string           // "injective"
  chainId: string         // "1439" testnet, "2525" mainnet
  agentType: string       // e.g. "trading"
  builderCode: string
  operatorAddress: string // 0x... EVM address
}

export interface AgentCard {
  type: string            // ERC-8004 spec URI
  name: string
  description?: string
  image: string           // URL or empty string
  services: ServiceEntry[]
  x402Support: boolean
  metadata: AgentCardMetadata
}

export interface GenerateCardOptions {
  name: string
  agentType: string
  builderCode: string
  operatorAddress: string
  chainId: number
  description?: string
  image?: string
  services?: ServiceEntry[]
}

export interface CardUpdates {
  name?: string
  description?: string
  image?: string
  services?: ServiceEntry[]
  removeServices?: string[]
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/identity/types.ts
git commit -m "feat(identity): add AgentCard and ServiceEntry type definitions"
```

---

## Task 2: Create `identity/storage.ts` — Pinata IPFS Upload

**Files:**
- Create: `src/identity/storage.ts`
- Test: `src/identity/storage.test.ts`

**Step 1: Write failing tests**

```typescript
// src/identity/storage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { PinataStorage, StorageError } from './storage.js'

describe('PinataStorage', () => {
  const storage = new PinataStorage('test-jwt-token')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads JSON and returns ipfs:// URI', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ IpfsHash: 'bafkreitest123' }),
    })

    const uri = await storage.uploadJSON({ name: 'TestBot' }, 'test-card')

    expect(uri).toBe('ipfs://bafkreitest123')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-jwt-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('throws StorageError on HTTP failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow(StorageError)
    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow('401')
  })

  it('throws StorageError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow(StorageError)
  })
})
```

**Step 2: Write implementation**

```typescript
// src/identity/storage.ts

export class StorageError extends Error {
  readonly code = 'STORAGE_ERROR'
  constructor(reason: string) {
    super(`IPFS storage error: ${reason}`)
    this.name = 'StorageError'
  }
}

const PINATA_PIN_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS'

export class PinataStorage {
  private jwt: string

  constructor(jwt: string) {
    this.jwt = jwt
  }

  async uploadJSON(data: unknown, name: string): Promise<string> {
    try {
      const response = await fetch(PINATA_PIN_JSON_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pinataContent: data,
          pinataMetadata: { name },
          pinataOptions: { cidVersion: 1 },
        }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new StorageError(
          `Pinata upload failed (HTTP ${response.status}): ${body.slice(0, 200)}`,
        )
      }

      const result = (await response.json()) as { IpfsHash: string }
      return `ipfs://${result.IpfsHash}`
    } catch (err) {
      if (err instanceof StorageError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new StorageError(message)
    }
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run src/identity/storage.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/identity/storage.ts src/identity/storage.test.ts
git commit -m "feat(identity): add PinataStorage for IPFS uploads"
```

---

## Task 3: Create `identity/card.ts` — Card Generation, Fetch, Merge

**Files:**
- Create: `src/identity/card.ts`
- Test: `src/identity/card.test.ts`

**Step 1: Write failing tests**

```typescript
// src/identity/card.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateAgentCard, fetchAgentCard, mergeAgentCard, validateImageUrl } from './card.js'
import type { AgentCard } from './types.js'

// Mock fetch for fetchAgentCard
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('generateAgentCard', () => {
  it('builds a valid agent card with all fields', () => {
    const card = generateAgentCard({
      name: 'TradeBot',
      agentType: 'trading',
      builderCode: 'acme-001',
      operatorAddress: '0xabc',
      chainId: 1439,
      description: 'An automated trading agent',
      image: 'https://example.com/bot.png',
      services: [{ type: 'mcp', url: 'https://mcp.example.com' }],
    })

    expect(card.name).toBe('TradeBot')
    expect(card.description).toBe('An automated trading agent')
    expect(card.image).toBe('https://example.com/bot.png')
    expect(card.services).toHaveLength(1)
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
})

describe('validateImageUrl', () => {
  it('accepts https URL', () => {
    expect(() => validateImageUrl('https://example.com/img.png')).not.toThrow()
  })
  it('accepts http URL', () => {
    expect(() => validateImageUrl('http://example.com/img.png')).not.toThrow()
  })
  it('accepts ipfs:// URL', () => {
    expect(() => validateImageUrl('ipfs://QmTest')).not.toThrow()
  })
  it('accepts empty string', () => {
    expect(() => validateImageUrl('')).not.toThrow()
  })
  it('rejects local file paths', () => {
    expect(() => validateImageUrl('/tmp/img.png')).toThrow('Image must be a URL')
  })
  it('rejects relative paths', () => {
    expect(() => validateImageUrl('images/bot.png')).toThrow('Image must be a URL')
  })
})

describe('fetchAgentCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches and parses card from IPFS gateway', async () => {
    const mockCard: AgentCard = {
      type: 'https://erc8004.org/agent-card',
      name: 'Bot', image: '', services: [], x402Support: false,
      metadata: { chain: 'injective', chainId: '1439', agentType: 'trading', builderCode: 'x', operatorAddress: '0x1' },
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockCard,
    })

    const card = await fetchAgentCard('ipfs://QmTest', 'https://w3s.link/ipfs/')
    expect(card).toEqual(mockCard)
    expect(mockFetch).toHaveBeenCalledWith('https://w3s.link/ipfs/QmTest')
  })

  it('fetches from https:// URI directly', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Bot' }),
    })

    await fetchAgentCard('https://example.com/card.json', 'https://w3s.link/ipfs/')
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/card.json')
  })

  it('returns null on fetch failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' })
    const card = await fetchAgentCard('ipfs://QmBad', 'https://w3s.link/ipfs/')
    expect(card).toBeNull()
  })

  it('returns null for empty URI', async () => {
    const card = await fetchAgentCard('', 'https://w3s.link/ipfs/')
    expect(card).toBeNull()
  })
})

describe('mergeAgentCard', () => {
  const base: AgentCard = {
    type: 'https://erc8004.org/agent-card',
    name: 'Bot', description: 'Old desc', image: 'https://old.png',
    services: [{ type: 'mcp', url: 'https://mcp.old' }],
    x402Support: false,
    metadata: { chain: 'injective', chainId: '1439', agentType: 'trading', builderCode: 'x', operatorAddress: '0x1' },
  }

  it('updates image only', () => {
    const merged = mergeAgentCard(base, { image: 'https://new.png' })
    expect(merged.image).toBe('https://new.png')
    expect(merged.description).toBe('Old desc')
    expect(merged.services).toEqual(base.services)
  })

  it('updates description only', () => {
    const merged = mergeAgentCard(base, { description: 'New desc' })
    expect(merged.description).toBe('New desc')
    expect(merged.image).toBe('https://old.png')
  })

  it('replaces services', () => {
    const merged = mergeAgentCard(base, {
      services: [{ type: 'rest', url: 'https://api.new' }],
    })
    expect(merged.services).toEqual([{ type: 'rest', url: 'https://api.new' }])
  })

  it('removes services by type', () => {
    const merged = mergeAgentCard(base, { removeServices: ['mcp'] })
    expect(merged.services).toEqual([])
  })

  it('updates name in card', () => {
    const merged = mergeAgentCard(base, { name: 'NewBot' })
    expect(merged.name).toBe('NewBot')
  })
})
```

**Step 2: Write implementation**

```typescript
// src/identity/card.ts
import type { AgentCard, GenerateCardOptions, CardUpdates } from './types.js'

const AGENT_CARD_TYPE = 'https://erc8004.org/agent-card'

export function validateImageUrl(image: string): void {
  if (!image) return
  if (image.startsWith('https://') || image.startsWith('http://') || image.startsWith('ipfs://')) return
  throw new Error('Image must be a URL (https://, http://, or ipfs://). Local file paths are not supported in MCP.')
}

export function generateAgentCard(opts: GenerateCardOptions): AgentCard {
  if (opts.image) validateImageUrl(opts.image)

  const card: AgentCard = {
    type: AGENT_CARD_TYPE,
    name: opts.name,
    image: opts.image || '',
    services: opts.services ?? [],
    x402Support: false,
    metadata: {
      chain: 'injective',
      chainId: String(opts.chainId),
      agentType: opts.agentType,
      builderCode: opts.builderCode,
      operatorAddress: opts.operatorAddress,
    },
  }

  if (opts.description) {
    card.description = opts.description
  }

  return card
}

export async function fetchAgentCard(
  uri: string,
  ipfsGateway: string,
): Promise<AgentCard | null> {
  if (!uri) return null

  try {
    const url = uri.startsWith('ipfs://')
      ? `${ipfsGateway}${uri.slice('ipfs://'.length)}`
      : uri

    const response = await fetch(url)
    if (!response.ok) return null

    return (await response.json()) as AgentCard
  } catch {
    return null
  }
}

export function mergeAgentCard(existing: AgentCard, updates: CardUpdates): AgentCard {
  const merged = { ...existing }

  if (updates.name !== undefined) merged.name = updates.name
  if (updates.description !== undefined) merged.description = updates.description
  if (updates.image !== undefined) {
    validateImageUrl(updates.image)
    merged.image = updates.image
  }
  if (updates.services !== undefined) {
    merged.services = updates.services
  }
  if (updates.removeServices?.length) {
    merged.services = merged.services.filter(
      (s) => !updates.removeServices!.includes(s.type),
    )
  }

  return merged
}
```

**Step 3: Run tests**

Run: `npx vitest run src/identity/card.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/identity/card.ts src/identity/card.test.ts
git commit -m "feat(identity): add agent card generation, fetch, and merge"
```

---

## Task 4: Add IPFS Config and StorageError

**Files:**
- Modify: `src/identity/config.ts`
- Modify: `src/identity/config.test.ts`
- Modify: `src/errors/index.ts` (add StorageError re-export or keep in storage.ts)

**Step 1: Add `ipfsGateway` to IdentityConfig and read `PINATA_JWT` from env**

Add to `IdentityConfig`:
```typescript
ipfsGateway: string
```

Add to both TESTNET and MAINNET configs:
```typescript
ipfsGateway: process.env['IPFS_GATEWAY'] || 'https://w3s.link/ipfs/',
```

Create a module-level accessor for the Pinata JWT (read from env, not stored in config to avoid leaking):
```typescript
export function getPinataJwt(): string | undefined {
  return process.env['PINATA_JWT']
}
```

**Step 2: Update config tests**

Add test: `it('has ipfsGateway', () => expect(cfg.ipfsGateway).toContain('ipfs'))`.

**Step 3: Commit**

```bash
git add src/identity/config.ts src/identity/config.test.ts
git commit -m "feat(identity): add IPFS gateway config and Pinata JWT accessor"
```

---

## Task 5: Integrate Card + IPFS into Register Handler

**Files:**
- Modify: `src/identity/index.ts`
- Modify: `src/identity/identity.test.ts`

This is the core integration. The register handler gains:
1. New optional params: `description`, `image`, `services`
2. When `uri` is not provided: build AgentCard → upload to Pinata → use resulting URI
3. When `uri` is provided: skip card/IPFS, use URI directly
4. `RegisterResult` gains `cardUri` field

**Key logic:**

```typescript
// Inside register handler, before the contract call:
let cardUri = params.uri ?? ''
if (!params.uri) {
  const jwt = getPinataJwt()
  if (!jwt) {
    throw new IdentityTxFailed(
      'IPFS storage not configured. Set PINATA_JWT environment variable or provide a uri parameter.'
    )
  }

  if (params.image) validateImageUrl(params.image)

  const card = generateAgentCard({
    name: params.name,
    agentType: params.type,
    builderCode: params.builderCode,
    operatorAddress: ctx.account.address,
    chainId: ctx.identityCfg.chainId,
    description: params.description,
    image: params.image,
    services: params.services,
  })

  const storage = new PinataStorage(jwt)
  cardUri = await storage.uploadJSON(card, `agent-card-${params.name}`)
}
// Then pass cardUri to register(cardUri, metadata[])
```

**RegisterParams additions:**
```typescript
description?: string
image?: string
services?: ServiceEntry[]
```

**RegisterResult additions:**
```typescript
cardUri: string  // the IPFS URI or provided URI
```

**Tests:** Mock `PinataStorage` and `generateAgentCard` imports. Test:
- Register without uri → builds card, uploads, passes IPFS URI to contract
- Register with uri → skips card/IPFS, passes URI directly
- Register without uri AND without PINATA_JWT → throws clear error
- Invalid image URL → throws validation error

**Commit:**
```bash
git commit -m "feat(identity): integrate agent card generation and IPFS upload into register"
```

---

## Task 6: Integrate Card Fetch/Merge into Update Handler

**Files:**
- Modify: `src/identity/index.ts`
- Modify: `src/identity/identity.test.ts`

The update handler gains:
1. New optional params: `description`, `image`, `services`, `removeServices`
2. When card-level fields change AND uri is not provided directly: fetch existing card → merge updates → re-upload → call setAgentURI
3. When only metadata fields change (name/type/builderCode): no card operations

**Key logic:**

```typescript
const hasCardUpdate = params.description !== undefined || params.image !== undefined
  || params.services !== undefined || params.removeServices?.length

if (hasCardUpdate && !params.uri) {
  const jwt = getPinataJwt()
  if (!jwt) throw new IdentityTxFailed('IPFS storage not configured...')

  if (params.image) validateImageUrl(params.image)

  // Fetch existing card
  const tokenURI = await ctx.publicClient.readContract({
    address: ctx.identityCfg.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: [id],
  }) as string

  let card = await fetchAgentCard(tokenURI, ctx.identityCfg.ipfsGateway)

  if (card) {
    card = mergeAgentCard(card, {
      name: params.name, description: params.description,
      image: params.image, services: params.services,
      removeServices: params.removeServices,
    })
  } else {
    // No existing card — build from scratch using update params + on-chain data
    card = generateAgentCard({
      name: params.name ?? '',
      agentType: params.type ?? '',
      builderCode: params.builderCode ?? '',
      operatorAddress: ctx.account.address,
      chainId: ctx.identityCfg.chainId,
      description: params.description,
      image: params.image,
      services: params.services,
    })
  }

  const storage = new PinataStorage(jwt)
  const newUri = await storage.uploadJSON(card, `agent-card-${params.agentId}`)

  // Add setAgentURI tx
  const txHash = await ctx.walletClient.writeContract({ ..., functionName: 'setAgentURI', args: [id, newUri] })
  pendingHashes.push(txHash)
}
```

**UpdateParams additions:**
```typescript
description?: string
image?: string
services?: ServiceEntry[]
removeServices?: string[]
```

**UpdateResult additions:**
```typescript
cardUri?: string
```

**Tests:** Mock fetch + PinataStorage. Test:
- Update image → fetches existing card, merges, re-uploads, calls setAgentURI
- Update description → same flow
- Update only name (metadata-only) → no card operations
- Update card field on agent with empty tokenURI → builds card from scratch

**Commit:**
```bash
git commit -m "feat(identity): integrate card fetch-merge-reupload into update"
```

---

## Task 7: Update Tool Schemas in server.ts

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/server.test.ts`

Add new params to `agent_register`:
```typescript
description: z.string().optional().describe('Short description of what the agent does.'),
image: z.string().optional().describe('Image URL (https://, http://, or ipfs://). Displayed on 8004scan.'),
services: z.array(z.object({
  type: z.enum(['a2a', 'mcp', 'rest', 'grpc', 'webhook', 'custom']).describe('Service type.'),
  url: z.string().url().describe('Service endpoint URL.'),
  description: z.string().optional().describe('Service description.'),
})).optional().describe('Service endpoints the agent exposes.'),
```

Add new params to `agent_update`:
```typescript
description: z.string().optional().describe('New agent description.'),
image: z.string().optional().describe('New image URL.'),
services: z.array(...).optional().describe('New service endpoints (replaces existing).'),
removeServices: z.array(z.string()).optional().describe('Service types to remove.'),
```

Update `agent_register` description to mention auto-card generation and PINATA_JWT.

**Commit:**
```bash
git commit -m "feat(identity): add card params to agent_register and agent_update tool schemas"
```

---

## Task 8: Verification + Integration Test

**Files:**
- Modify: `src/integration/identity.integration.test.ts`
- Modify: `scripts/register-test-agent.ts`

1. `npx tsc --noEmit` — clean
2. `npm test` — all pass
3. `npm run build` — clean
4. Update integration test to pass description and image to register
5. Update demo script to use card generation

**Commit:**
```bash
git commit -m "test(identity): update integration test for agent card flow"
```

---

## Summary

| Task | What | Files | Key |
|------|------|-------|-----|
| 1 | Type definitions | `types.ts` | AgentCard, ServiceEntry, CardUpdates |
| 2 | IPFS storage | `storage.ts` + test | PinataStorage.uploadJSON → ipfs:// |
| 3 | Card generation | `card.ts` + test | generate, fetch, merge, validateImageUrl |
| 4 | Config extension | `config.ts` | ipfsGateway, getPinataJwt() |
| 5 | Register integration | `index.ts` + test | Build card → upload → register(uri, metadata[]) |
| 6 | Update integration | `index.ts` + test | Fetch card → merge → re-upload → setAgentURI |
| 7 | Tool schemas | `server.ts` | description, image, services params |
| 8 | Verification | integration test | E2E with Pinata on testnet |

**New files:** 4 (`types.ts`, `storage.ts`, `card.ts`, + tests)
**Modified files:** 4 (`config.ts`, `index.ts`, `server.ts`, + tests)
**Estimated commits:** 8
