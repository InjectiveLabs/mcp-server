# ERC-8004 Identity Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 ERC-8004 identity tools (`agent_register`, `agent_update`, `agent_deregister`, `agent_status`, `agent_list`) to the Injective MCP server, enabling agents to manage on-chain identity alongside existing trading tools.

**Architecture:** New self-contained `src/identity/` module following the exact pattern of existing modules (trading, transfers, etc.). Uses `viem` for EVM contract calls to IdentityRegistry and ReputationRegistry on Injective EVM. Reuses the existing keystore (`wallets.unlock()`) for key resolution. Read-only operations use a viem public client; write operations derive a viem wallet client from the same private key used for Cosmos signing.

**Tech Stack:** viem 2.x (EVM client), bech32 2.x (address decode/validation), vitest (testing), zod 3.x (tool schemas)

**PRD:** PRD-ecosystem-growth-2026-021

**Note on tool count:** The PRD title says "6 tools" but the detailed requirements define exactly 5 tool names. The discrepancy is from an earlier draft that had `agent_reputation` as a separate tool before it was merged into `agent_status`. This plan implements the 5 tools described in the requirements.

---

## Codebase Patterns Reference

These patterns are derived from the current codebase and MUST be followed exactly.

### Module Export Pattern
```typescript
// src/{module}/index.ts
export const moduleName = {
  async handlerName(config: Config, params: Params): Promise<Result> {
    // ... implementation
  },
}
```

### Tool Registration Pattern (server.ts)
```typescript
server.tool(
  'tool_name',
  'Tool description for the LLM.',
  {
    param: z.string().describe('Param description.'),
  },
  async ({ param }) => {
    const result = await module.handler(config, { param })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)
```

### Error Pattern (errors/index.ts)
```typescript
export class ErrorName extends Error {
  readonly code = 'ERROR_CODE'
  constructor(detail: string) {
    super(`Human-readable message: ${detail}`)
    this.name = 'ErrorName'
  }
}
```

### Keystore Bridge
```typescript
// wallets.unlock(address, password) → hex private key string
// Throws WalletNotFound or WrongPassword
const privateKeyHex = wallets.unlock(address, password)
```

### Test Pattern (vitest)
```typescript
import { describe, it, expect, vi } from 'vitest'

describe('moduleName', () => {
  it('does specific thing', () => {
    expect(result).toEqual(expected)
  })
})
```

---

## Prerequisites

Before starting, the actual contract ABIs and addresses must be sourced:

1. Clone `InjectiveLabs/injective-agent-cli` (the agent-sdk repo)
2. Copy IdentityRegistry ABI from `packages/sdk/src/abis/IdentityRegistry.json`
3. Copy ReputationRegistry ABI from `packages/sdk/src/abis/ReputationRegistry.json`
4. Copy contract addresses and deploy blocks from `packages/sdk/src/config.ts`
5. Copy EVM RPC URLs from the agent-sdk config

If the agent-sdk repo is not accessible, the ABIs can be generated from the Solidity interfaces in the ERC-8004 spec. The plan includes placeholder ABI structures with the required function signatures.

**EVM Chain ID note:** The existing config uses `ethereumChainId: 1776` (mainnet) / `1439` (testnet). The PRD references `2525` (mainnet) / `1439` (testnet). The identity module's config will store its own EVM RPC URLs and chain IDs. Verify the correct mainnet chain ID against the actual Injective EVM JSON-RPC endpoint before shipping.

---

## Task 1: Add viem and bech32 Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install viem**

Run: `npm install viem@2.47.6`
Expected: viem added to dependencies in package.json

**Step 2: Install bech32**

Run: `npm install bech32@2.0.0`
Expected: bech32 added to dependencies in package.json

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No new type errors. Existing code unaffected.

**Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: All existing tests pass (zero regressions — NFR-02).

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add viem and bech32 dependencies for ERC-8004 identity tools"
```

---

## Task 2: Create Identity Config

**Files:**
- Create: `src/identity/config.ts`
- Test: `src/identity/config.test.ts`

This file holds contract addresses, EVM RPC URLs, and deploy block numbers per network. Self-contained — no imports from other src/ modules except the `NetworkName` type from config.

**Step 1: Write the failing test**

```typescript
// src/identity/config.test.ts
import { describe, it, expect } from 'vitest'
import { getIdentityConfig } from './config.js'

describe('getIdentityConfig', () => {
  it('returns testnet config with correct chain ID', () => {
    const cfg = getIdentityConfig('testnet')
    expect(cfg.chainId).toBe(1439)
    expect(cfg.rpcUrl).toContain('testnet')
    expect(cfg.identityRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(cfg.reputationRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(typeof cfg.deployBlock).toBe('bigint')
  })

  it('returns mainnet config with correct chain ID', () => {
    const cfg = getIdentityConfig('mainnet')
    expect(cfg.chainId).toBe(2525)
    expect(cfg.rpcUrl).toContain('mainnet')
    expect(cfg.identityRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(cfg.reputationRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  it('returns different addresses per network', () => {
    const testnet = getIdentityConfig('testnet')
    const mainnet = getIdentityConfig('mainnet')
    expect(testnet.identityRegistry).not.toBe(mainnet.identityRegistry)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/identity/config.test.ts`
Expected: FAIL — module `./config.js` not found

**Step 3: Write the implementation**

```typescript
// src/identity/config.ts
import type { NetworkName } from '../config/index.js'

export interface IdentityConfig {
  chainId: number
  rpcUrl: string
  identityRegistry: `0x${string}`
  reputationRegistry: `0x${string}`
  deployBlock: bigint
}

// ── Contract addresses — copied from agent-sdk config ───────────────────────
// TODO: Replace placeholder addresses with actual deployed contract addresses
//       from InjectiveLabs/injective-agent-cli packages/sdk/src/config.ts

const TESTNET: IdentityConfig = {
  chainId: 1439,
  rpcUrl: 'https://k8s.testnet.json-rpc.injective.network',
  identityRegistry: '0x0000000000000000000000000000000000000001',   // TODO: real address
  reputationRegistry: '0x0000000000000000000000000000000000000002', // TODO: real address
  deployBlock: 0n, // TODO: real deploy block
}

const MAINNET: IdentityConfig = {
  chainId: 2525,
  rpcUrl: 'https://json-rpc.injective.network',
  identityRegistry: '0x0000000000000000000000000000000000000001',   // TODO: real address
  reputationRegistry: '0x0000000000000000000000000000000000000002', // TODO: real address
  deployBlock: 0n, // TODO: real deploy block
}

const CONFIGS: Record<NetworkName, IdentityConfig> = {
  testnet: TESTNET,
  mainnet: MAINNET,
}

export function getIdentityConfig(network: NetworkName): IdentityConfig {
  return CONFIGS[network]
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/identity/config.test.ts`
Expected: PASS (3 tests). The "different addresses per network" test will need real addresses to pass meaningfully — for now both networks have different placeholders, which is fine for the structure.

**Step 5: Commit**

```bash
git add src/identity/config.ts src/identity/config.test.ts
git commit -m "feat(identity): add EVM config for ERC-8004 contracts per network"
```

---

## Task 3: Create Contract ABIs

**Files:**
- Create: `src/identity/abis.ts`

No tests needed — this is pure data. The ABIs define the contract interfaces used by viem's `readContract` / `writeContract`.

**Step 1: Create the ABI file**

```typescript
// src/identity/abis.ts
//
// Contract ABIs for ERC-8004 IdentityRegistry and ReputationRegistry.
// Source: copied from InjectiveLabs/injective-agent-cli packages/sdk/src/abis/
//
// TODO: Replace these minimal ABIs with the full ABIs from the agent-sdk repo.
//       These contain only the functions and events used by the identity module.

export const IDENTITY_REGISTRY_ABI = [
  // ── Write functions ──
  {
    name: 'registerAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'builderCode', type: 'bytes32' },
      { name: 'uri', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    name: 'updateMetadata',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'builderCode', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'setTokenURI',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'setLinkedWallet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'wallet', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'deregister',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  // ── Read functions ──
  {
    name: 'getMetadata',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'builderCode', type: 'bytes32' },
    ],
  },
  {
    name: 'getLinkedWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'wallet', type: 'address' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  // ── Events ──
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

export const REPUTATION_REGISTRY_ABI = [
  {
    name: 'getReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'score', type: 'uint256' },
      { name: 'feedbackCount', type: 'uint256' },
    ],
  },
] as const
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/identity/abis.ts
git commit -m "feat(identity): add ERC-8004 IdentityRegistry and ReputationRegistry ABIs"
```

---

## Task 4: Add Identity Error Classes

**Files:**
- Modify: `src/errors/index.ts`
- Test: `src/errors/errors.test.ts`

**Step 1: Read current errors.test.ts to understand existing test patterns**

Run: `cat src/errors/errors.test.ts` (or Read tool)

**Step 2: Write failing tests for new error classes**

Add to `src/errors/errors.test.ts`:

```typescript
describe('IdentityRegistrationFailed', () => {
  it('has correct code and message', () => {
    const err = new IdentityRegistrationFailed('WalletAlreadyLinked')
    expect(err.code).toBe('IDENTITY_REGISTRATION_FAILED')
    expect(err.message).toContain('WalletAlreadyLinked')
    expect(err.name).toBe('IdentityRegistrationFailed')
  })
})

describe('IdentityNotFound', () => {
  it('has correct code and message', () => {
    const err = new IdentityNotFound('42')
    expect(err.code).toBe('IDENTITY_NOT_FOUND')
    expect(err.message).toContain('42')
    expect(err.name).toBe('IdentityNotFound')
  })
})

describe('IdentityTxFailed', () => {
  it('has correct code and message', () => {
    const err = new IdentityTxFailed('revert reason')
    expect(err.code).toBe('IDENTITY_TX_FAILED')
    expect(err.message).toContain('revert reason')
    expect(err.name).toBe('IdentityTxFailed')
  })
})

describe('DeregisterNotConfirmed', () => {
  it('has correct code and message', () => {
    const err = new DeregisterNotConfirmed()
    expect(err.code).toBe('DEREGISTER_NOT_CONFIRMED')
    expect(err.message).toContain('confirm=true')
    expect(err.name).toBe('DeregisterNotConfirmed')
  })
})
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run src/errors/errors.test.ts`
Expected: FAIL — IdentityRegistrationFailed is not defined

**Step 4: Add error classes to errors/index.ts**

Append to `src/errors/index.ts`:

```typescript
export class IdentityRegistrationFailed extends Error {
  readonly code = 'IDENTITY_REGISTRATION_FAILED'
  constructor(reason: string) {
    super(`Agent registration failed: ${reason}`)
    this.name = 'IdentityRegistrationFailed'
  }
}

export class IdentityNotFound extends Error {
  readonly code = 'IDENTITY_NOT_FOUND'
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`)
    this.name = 'IdentityNotFound'
  }
}

export class IdentityTxFailed extends Error {
  readonly code = 'IDENTITY_TX_FAILED'
  constructor(reason: string) {
    super(`Identity transaction failed: ${reason}`)
    this.name = 'IdentityTxFailed'
  }
}

export class DeregisterNotConfirmed extends Error {
  readonly code = 'DEREGISTER_NOT_CONFIRMED'
  constructor() {
    super('Must set confirm=true to deregister (irreversible)')
    this.name = 'DeregisterNotConfirmed'
  }
}
```

**Step 5: Update test imports and run**

Run: `npx vitest run src/errors/errors.test.ts`
Expected: PASS — all error tests green.

**Step 6: Commit**

```bash
git add src/errors/index.ts src/errors/errors.test.ts
git commit -m "feat(identity): add error classes for ERC-8004 identity operations"
```

---

## Task 5: Implement Identity Viem Client Factory

**Files:**
- Create: `src/identity/client.ts`
- Test: `src/identity/client.test.ts`

This creates the viem public and wallet clients used by all identity handlers. Separate from the existing `src/client/` which is for Cosmos gRPC.

**Step 1: Write failing tests**

```typescript
// src/identity/client.test.ts
import { describe, it, expect } from 'vitest'
import { createIdentityPublicClient, createIdentityWalletClient } from './client.js'

describe('createIdentityPublicClient', () => {
  it('creates a client for testnet', () => {
    const client = createIdentityPublicClient('testnet')
    expect(client).toBeDefined()
    expect(client.chain?.id).toBe(1439)
  })

  it('creates a client for mainnet', () => {
    const client = createIdentityPublicClient('mainnet')
    expect(client).toBeDefined()
    expect(client.chain?.id).toBe(2525)
  })
})

describe('createIdentityWalletClient', () => {
  it('creates a wallet client from a private key', () => {
    // Well-known test private key (do NOT use on mainnet)
    const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const client = createIdentityWalletClient('testnet', testKey)
    expect(client).toBeDefined()
    expect(client.account?.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(client.chain?.id).toBe(1439)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/identity/client.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/identity/client.ts
import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PublicClient, WalletClient, Chain, Account } from 'viem'
import type { NetworkName } from '../config/index.js'
import { getIdentityConfig } from './config.js'

function buildChain(network: NetworkName): Chain {
  const cfg = getIdentityConfig(network)
  return defineChain({
    id: cfg.chainId,
    name: network === 'mainnet' ? 'Injective EVM' : 'Injective EVM Testnet',
    nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
    rpcUrls: {
      default: { http: [cfg.rpcUrl] },
    },
  })
}

export function createIdentityPublicClient(network: NetworkName): PublicClient {
  const chain = buildChain(network)
  return createPublicClient({ chain, transport: http() })
}

export function createIdentityWalletClient(
  network: NetworkName,
  privateKeyHex: string,
): WalletClient {
  const chain = buildChain(network)
  const key = privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`
  const account = privateKeyToAccount(key as `0x${string}`)
  return createWalletClient({ account, chain, transport: http() })
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/identity/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/identity/client.ts src/identity/client.test.ts
git commit -m "feat(identity): add viem client factory for Injective EVM"
```

---

## Task 6: Implement agent_register Handler

**Files:**
- Create: `src/identity/index.ts`
- Test: `src/identity/identity.test.ts`

**Step 1: Write failing test**

```typescript
// src/identity/identity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock viem before imports
vi.mock('./client.js', () => ({
  createIdentityWalletClient: vi.fn(),
  createIdentityPublicClient: vi.fn(),
}))

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn(),
  },
}))

import { identity } from './index.js'
import { createIdentityWalletClient, createIdentityPublicClient } from './client.js'
import { wallets } from '../wallets/index.js'
import { testConfig } from '../test-utils/index.js'
import type { Config } from '../config/index.js'

const config = testConfig()

describe('identity.register', () => {
  const mockTxHash = '0x' + 'ab'.repeat(32)
  const mockWriteContract = vi.fn().mockResolvedValue(mockTxHash)
  const mockWaitForTransactionReceipt = vi.fn().mockResolvedValue({
    status: 'success',
    logs: [{ topics: ['0x0', '0x0', '0x0', '0x000000000000000000000000000000000000000000000000000000000000002a'] }],
  })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(wallets.unlock as ReturnType<typeof vi.fn>).mockReturnValue('0x' + 'aa'.repeat(32))
    ;(createIdentityWalletClient as ReturnType<typeof vi.fn>).mockReturnValue({
      writeContract: mockWriteContract,
      account: { address: '0x' + 'bb'.repeat(20) },
    })
    ;(createIdentityPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    })
  })

  it('registers an agent and returns agentId + txHash', async () => {
    const result = await identity.register(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpassword',
      name: 'MyTradingBot',
      type: 1,
      builderCode: '0x' + 'cc'.repeat(32),
      wallet: '0x' + 'dd'.repeat(20),
    })

    expect(wallets.unlock).toHaveBeenCalledWith('inj1' + 'a'.repeat(38), 'testpassword')
    expect(createIdentityWalletClient).toHaveBeenCalledWith('testnet', '0x' + 'aa'.repeat(32))
    expect(mockWriteContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'registerAgent',
    }))
    expect(result).toHaveProperty('txHash', mockTxHash)
    expect(result).toHaveProperty('agentId')
  })

  it('passes optional uri and description', async () => {
    await identity.register(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpassword',
      name: 'MyBot',
      type: 1,
      builderCode: '0x' + 'cc'.repeat(32),
      wallet: '0x' + 'dd'.repeat(20),
      uri: 'ipfs://Qm...',
    })

    expect(mockWriteContract).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['MyBot']),
    }))
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/identity/identity.test.ts`
Expected: FAIL — `identity` not exported from `./index.js`

**Step 3: Write the register handler**

```typescript
// src/identity/index.ts
import type { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { getIdentityConfig } from './config.js'
import { createIdentityPublicClient, createIdentityWalletClient } from './client.js'
import { IDENTITY_REGISTRY_ABI } from './abis.js'
import { IdentityTxFailed } from '../errors/index.js'
import { DeregisterNotConfirmed } from '../errors/index.js'

// ── Param / Result interfaces ───────────────────────────────────────────────

export interface RegisterParams {
  address: string
  password: string
  name: string
  type: number
  builderCode: string
  wallet: string
  uri?: string
  description?: string
  services?: string[]
}

export interface RegisterResult {
  agentId: string
  txHash: string
  owner: string
  evmAddress: string
}

export interface UpdateParams {
  address: string
  password: string
  agentId: string
  name?: string
  type?: number
  builderCode?: string
  uri?: string
  wallet?: string
}

export interface UpdateResult {
  agentId: string
  txHashes: string[]
}

export interface DeregisterParams {
  address: string
  password: string
  agentId: string
  confirm: boolean
}

export interface DeregisterResult {
  agentId: string
  txHash: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseAgentIdFromReceipt(receipt: { logs: readonly { topics: readonly string[] }[] }): string {
  // The Transfer event (mint) has the agentId as the third indexed topic
  for (const log of receipt.logs) {
    if (log.topics.length >= 4) {
      const agentId = BigInt(log.topics[3]!)
      return agentId.toString()
    }
  }
  return 'unknown'
}

// ── Handlers ────────────────────────────────────────────────────────────────

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    const { address, password, name, type, builderCode, wallet, uri } = params
    const identityCfg = getIdentityConfig(config.network)

    const privateKeyHex = wallets.unlock(address, password)
    const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
    const publicClient = createIdentityPublicClient(config.network)
    const evmAddress = walletClient.account!.address

    try {
      const txHash = await walletClient.writeContract({
        address: identityCfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'registerAgent',
        args: [name, type, builderCode as `0x${string}`, uri ?? '', wallet as `0x${string}`],
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const agentId = parseAgentIdFromReceipt(receipt as { logs: readonly { topics: readonly string[] }[] })

      return { agentId, txHash, owner: evmAddress, evmAddress }
    } catch (err: unknown) {
      if (err instanceof IdentityTxFailed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(message)
    }
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    const { address, password, agentId, name, type, builderCode, uri, wallet } = params
    const identityCfg = getIdentityConfig(config.network)

    const privateKeyHex = wallets.unlock(address, password)
    const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
    const publicClient = createIdentityPublicClient(config.network)
    const txHashes: string[] = []
    const id = BigInt(agentId)

    try {
      // Update metadata if any metadata fields provided
      if (name !== undefined || type !== undefined || builderCode !== undefined) {
        // Need current values for fields not being updated
        const currentMeta = await publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [id],
        }) as [string, number, `0x${string}`]

        const txHash = await walletClient.writeContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'updateMetadata',
          args: [
            id,
            name ?? currentMeta[0],
            type ?? currentMeta[1],
            (builderCode ?? currentMeta[2]) as `0x${string}`,
          ],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      // Update URI if provided
      if (uri !== undefined) {
        const txHash = await walletClient.writeContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setTokenURI',
          args: [id, uri],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      // Update linked wallet if provided
      if (wallet !== undefined) {
        const txHash = await walletClient.writeContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setLinkedWallet',
          args: [id, wallet as `0x${string}`],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      return { agentId, txHashes }
    } catch (err: unknown) {
      if (err instanceof IdentityTxFailed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(message)
    }
  },

  async deregister(config: Config, params: DeregisterParams): Promise<DeregisterResult> {
    const { address, password, agentId, confirm } = params

    if (!confirm) {
      throw new DeregisterNotConfirmed()
    }

    const identityCfg = getIdentityConfig(config.network)
    const privateKeyHex = wallets.unlock(address, password)
    const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
    const publicClient = createIdentityPublicClient(config.network)

    try {
      const txHash = await walletClient.writeContract({
        address: identityCfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'deregister',
        args: [BigInt(agentId)],
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })
      return { agentId, txHash }
    } catch (err: unknown) {
      if (err instanceof IdentityTxFailed) throw err
      if (err instanceof DeregisterNotConfirmed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(message)
    }
  },
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/identity/identity.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/identity/index.ts src/identity/identity.test.ts
git commit -m "feat(identity): implement register, update, deregister handlers"
```

---

## Task 7: Test agent_update Handler

**Files:**
- Modify: `src/identity/identity.test.ts`

**Step 1: Write failing tests for update**

Add to `src/identity/identity.test.ts`:

```typescript
describe('identity.update', () => {
  const mockTxHash = '0x' + 'ab'.repeat(32)
  const mockWriteContract = vi.fn().mockResolvedValue(mockTxHash)
  const mockReadContract = vi.fn().mockResolvedValue(['OldName', 1, '0x' + 'cc'.repeat(32)])
  const mockWaitForTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success' })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(wallets.unlock as ReturnType<typeof vi.fn>).mockReturnValue('0x' + 'aa'.repeat(32))
    ;(createIdentityWalletClient as ReturnType<typeof vi.fn>).mockReturnValue({
      writeContract: mockWriteContract,
      account: { address: '0x' + 'bb'.repeat(20) },
    })
    ;(createIdentityPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
      readContract: mockReadContract,
    })
  })

  it('updates only metadata when name provided', async () => {
    const result = await identity.update(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpassword',
      agentId: '42',
      name: 'NewName',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'updateMetadata',
    }))
    expect(result.txHashes).toHaveLength(1)
  })

  it('sends separate tx for URI update', async () => {
    const result = await identity.update(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpassword',
      agentId: '42',
      uri: 'ipfs://new-uri',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'setTokenURI',
    }))
    expect(result.txHashes).toHaveLength(1)
  })

  it('sends multiple txs when updating name + uri + wallet', async () => {
    const result = await identity.update(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpassword',
      agentId: '42',
      name: 'NewName',
      uri: 'ipfs://new-uri',
      wallet: '0x' + 'dd'.repeat(20),
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(3)
    expect(result.txHashes).toHaveLength(3)
  })
})
```

**Step 2: Run test to verify it passes** (implementation already in Task 6)

Run: `npx vitest run src/identity/identity.test.ts`
Expected: PASS — all register + update tests green.

**Step 3: Commit**

```bash
git add src/identity/identity.test.ts
git commit -m "test(identity): add unit tests for agent_update handler"
```

---

## Task 8: Test agent_deregister Handler

**Files:**
- Modify: `src/identity/identity.test.ts`

**Step 1: Write tests for deregister**

Add to `src/identity/identity.test.ts`:

```typescript
describe('identity.deregister', () => {
  const mockTxHash = '0x' + 'ab'.repeat(32)
  const mockWriteContract = vi.fn().mockResolvedValue(mockTxHash)
  const mockWaitForTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success' })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(wallets.unlock as ReturnType<typeof vi.fn>).mockReturnValue('0x' + 'aa'.repeat(32))
    ;(createIdentityWalletClient as ReturnType<typeof vi.fn>).mockReturnValue({
      writeContract: mockWriteContract,
      account: { address: '0x' + 'bb'.repeat(20) },
    })
    ;(createIdentityPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    })
  })

  it('deregisters when confirm=true', async () => {
    const result = await identity.deregister(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpassword',
      agentId: '42',
      confirm: true,
    })

    expect(mockWriteContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'deregister',
      args: [42n],
    }))
    expect(result.txHash).toBe(mockTxHash)
    expect(result.agentId).toBe('42')
  })

  it('throws DeregisterNotConfirmed when confirm=false', async () => {
    await expect(
      identity.deregister(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpassword',
        agentId: '42',
        confirm: false,
      })
    ).rejects.toThrow('Must set confirm=true to deregister (irreversible)')

    expect(mockWriteContract).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/identity/identity.test.ts`
Expected: PASS — all tests green.

**Step 3: Commit**

```bash
git add src/identity/identity.test.ts
git commit -m "test(identity): add unit tests for agent_deregister handler"
```

---

## Task 9: Implement agent_status Read Handler

**Files:**
- Create: `src/identity/read.ts`
- Test: `src/identity/read.test.ts`

**Step 1: Write failing test**

```typescript
// src/identity/read.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client.js', () => ({
  createIdentityPublicClient: vi.fn(),
}))

import { identityRead } from './read.js'
import { createIdentityPublicClient } from './client.js'
import { testConfig } from '../test-utils/index.js'

const config = testConfig()

describe('identityRead.status', () => {
  const mockReadContract = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(createIdentityPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract,
    })
  })

  it('returns full agent details including reputation', async () => {
    // Mock sequential readContract calls
    mockReadContract
      .mockResolvedValueOnce(['MyBot', 1, '0x' + 'cc'.repeat(32)])  // getMetadata
      .mockResolvedValueOnce('0x' + 'dd'.repeat(20))                 // ownerOf
      .mockResolvedValueOnce('ipfs://Qm...')                          // tokenURI
      .mockResolvedValueOnce('0x' + 'ee'.repeat(20))                 // getLinkedWallet
      .mockResolvedValueOnce([85n, 10n])                              // getReputation

    const result = await identityRead.status(config, { agentId: '42' })

    expect(result.agentId).toBe('42')
    expect(result.name).toBe('MyBot')
    expect(result.agentType).toBe(1)
    expect(result.owner).toBe('0x' + 'dd'.repeat(20))
    expect(result.tokenURI).toBe('ipfs://Qm...')
    expect(result.linkedWallet).toBe('0x' + 'ee'.repeat(20))
    expect(result.reputation.score).toBe('85')
    expect(result.reputation.feedbackCount).toBe('10')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/identity/read.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/identity/read.ts
import type { Config } from '../config/index.js'
import { getIdentityConfig } from './config.js'
import { createIdentityPublicClient } from './client.js'
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI } from './abis.js'
import { IdentityNotFound } from '../errors/index.js'
import { getEthereumAddress } from '@injectivelabs/sdk-ts'

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface StatusParams {
  agentId: string
}

export interface StatusResult {
  agentId: string
  name: string
  agentType: number
  builderCode: string
  owner: string
  tokenURI: string
  linkedWallet: string
  reputation: {
    score: string
    feedbackCount: string
  }
}

export interface ListParams {
  owner?: string
  type?: number
  limit?: number
}

export interface ListEntry {
  agentId: string
  name: string
  agentType: number
  owner: string
}

export interface ListResult {
  agents: ListEntry[]
  total: number
}

// ── Handlers ────────────────────────────────────────────────────────────────

export const identityRead = {
  async status(config: Config, params: StatusParams): Promise<StatusResult> {
    const { agentId } = params
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const id = BigInt(agentId)

    try {
      const [metadata, owner, tokenURI, linkedWallet, reputation] = await Promise.all([
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [id],
        }) as Promise<[string, number, `0x${string}`]>,

        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'ownerOf',
          args: [id],
        }) as Promise<`0x${string}`>,

        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'tokenURI',
          args: [id],
        }) as Promise<string>,

        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getLinkedWallet',
          args: [id],
        }) as Promise<`0x${string}`>,

        publicClient.readContract({
          address: identityCfg.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: 'getReputation',
          args: [id],
        }) as Promise<[bigint, bigint]>,
      ])

      return {
        agentId,
        name: metadata[0],
        agentType: metadata[1],
        builderCode: metadata[2],
        owner: owner,
        tokenURI,
        linkedWallet,
        reputation: {
          score: reputation[0].toString(),
          feedbackCount: reputation[1].toString(),
        },
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      // ERC-721 ownerOf reverts for nonexistent tokens
      if (message.includes('ERC721') || message.includes('nonexistent') || message.includes('invalid token')) {
        throw new IdentityNotFound(agentId)
      }
      throw err
    }
  },

  async list(config: Config, params: ListParams): Promise<ListResult> {
    const { owner, type, limit = 20 } = params
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)

    // Resolve inj1... addresses to 0x... for filtering
    let ownerFilter: string | undefined
    if (owner) {
      ownerFilter = owner.startsWith('inj1') ? getEthereumAddress(owner) : owner
      ownerFilter = ownerFilter.toLowerCase()
    }

    try {
      // Scan Transfer events (mint = from 0x0) to discover agent IDs
      const logs = await publicClient.getLogs({
        address: identityCfg.identityRegistry,
        event: {
          name: 'Transfer',
          type: 'event',
          inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'tokenId', type: 'uint256', indexed: true },
          ],
        },
        args: {
          from: '0x0000000000000000000000000000000000000000',
        },
        fromBlock: identityCfg.deployBlock,
        toBlock: 'latest',
      })

      // Collect unique agent IDs from mint events
      const agentIds: bigint[] = []
      for (const log of logs) {
        const tokenId = log.args.tokenId
        if (tokenId !== undefined) {
          // If owner filter, check the mint recipient
          if (ownerFilter && log.args.to?.toLowerCase() !== ownerFilter) continue
          agentIds.push(tokenId)
        }
      }

      // Fetch metadata for each agent (up to limit)
      const capped = agentIds.slice(0, limit)
      const agents: ListEntry[] = []

      for (const id of capped) {
        try {
          const [metadata, currentOwner] = await Promise.all([
            publicClient.readContract({
              address: identityCfg.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'getMetadata',
              args: [id],
            }) as Promise<[string, number, `0x${string}`]>,
            publicClient.readContract({
              address: identityCfg.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'ownerOf',
              args: [id],
            }) as Promise<`0x${string}`>,
          ])

          // Apply type filter
          if (type !== undefined && metadata[1] !== type) continue

          agents.push({
            agentId: id.toString(),
            name: metadata[0],
            agentType: metadata[1],
            owner: currentOwner,
          })
        } catch {
          // Agent may have been burned — skip
          continue
        }
      }

      return { agents, total: agents.length }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to list agents: ${message}`)
    }
  },
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/identity/read.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/identity/read.ts src/identity/read.test.ts
git commit -m "feat(identity): implement agent_status and agent_list read handlers"
```

---

## Task 10: Test agent_list Read Handler

**Files:**
- Modify: `src/identity/read.test.ts`

**Step 1: Add tests for agent_list**

Add to `src/identity/read.test.ts`:

```typescript
describe('identityRead.list', () => {
  const mockReadContract = vi.fn()
  const mockGetLogs = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(createIdentityPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract,
      getLogs: mockGetLogs,
    })
  })

  it('returns agents from mint events', async () => {
    mockGetLogs.mockResolvedValue([
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'aa'.repeat(20), tokenId: 1n } },
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'bb'.repeat(20), tokenId: 2n } },
    ])

    mockReadContract
      // Agent 1 metadata + owner
      .mockResolvedValueOnce(['Bot1', 1, '0x' + 'cc'.repeat(32)])
      .mockResolvedValueOnce('0x' + 'aa'.repeat(20))
      // Agent 2 metadata + owner
      .mockResolvedValueOnce(['Bot2', 2, '0x' + 'dd'.repeat(32)])
      .mockResolvedValueOnce('0x' + 'bb'.repeat(20))

    const result = await identityRead.list(config, {})

    expect(result.agents).toHaveLength(2)
    expect(result.agents[0]!.name).toBe('Bot1')
    expect(result.agents[1]!.name).toBe('Bot2')
  })

  it('filters by agent type', async () => {
    mockGetLogs.mockResolvedValue([
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'aa'.repeat(20), tokenId: 1n } },
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'bb'.repeat(20), tokenId: 2n } },
    ])

    mockReadContract
      .mockResolvedValueOnce(['Bot1', 1, '0x' + 'cc'.repeat(32)])
      .mockResolvedValueOnce('0x' + 'aa'.repeat(20))
      .mockResolvedValueOnce(['Bot2', 2, '0x' + 'dd'.repeat(32)])
      .mockResolvedValueOnce('0x' + 'bb'.repeat(20))

    const result = await identityRead.list(config, { type: 1 })

    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]!.name).toBe('Bot1')
  })

  it('respects limit', async () => {
    mockGetLogs.mockResolvedValue([
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'aa'.repeat(20), tokenId: 1n } },
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'bb'.repeat(20), tokenId: 2n } },
      { args: { from: '0x' + '00'.repeat(20), to: '0x' + 'cc'.repeat(20), tokenId: 3n } },
    ])

    mockReadContract
      .mockResolvedValueOnce(['Bot1', 1, '0x' + 'cc'.repeat(32)])
      .mockResolvedValueOnce('0x' + 'aa'.repeat(20))

    const result = await identityRead.list(config, { limit: 1 })

    // Only 1 agent fetched due to limit
    expect(result.agents).toHaveLength(1)
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/identity/read.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/identity/read.test.ts
git commit -m "test(identity): add unit tests for agent_list handler"
```

---

## Task 11: Register 5 Identity Tools in server.ts

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Read the current end of server.ts** to find insertion point

The identity tools go before the `// ─── Start ───` section (currently line 812).

**Step 2: Add import and tool registrations**

Add import at top of server.ts (after existing module imports, ~line 27):

```typescript
import { identity } from '../identity/index.js'
import { identityRead } from '../identity/read.js'
```

Add Zod helper (near line 29, with existing schema helpers):

```typescript
const ethAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x... Ethereum address (42 chars)')
```

> **Note:** Check if `ethAddress` already exists in server.ts. If it does, reuse it. If not, add it.

Insert before `// ─── Start ───`:

```typescript
// ─── Identity Tools ─────────────────────────────────────────────────────────

server.tool(
  'agent_register',
  'Register a new AI agent identity on the Injective ERC-8004 registry. Mints an NFT that gives your agent on-chain identity, discoverability, and reputation tracking. IMPORTANT: This is a real on-chain transaction that costs gas.',
  {
    address: injAddress.describe('Your inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the signing key.'),
    name: z.string().min(1).describe('Human-readable agent name.'),
    type: z.number().int().min(0).max(255).describe('Agent type code (uint8). E.g., 1 = trading, 2 = analytics.'),
    builderCode: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a 32-byte hex string (0x-prefixed, 66 chars)')
      .describe('Builder identifier (bytes32).'),
    wallet: ethAddress.describe('EVM wallet address to link to this agent identity.'),
    uri: z.string().optional().describe('Token URI (e.g., IPFS link to agent card JSON). Can be set later via agent_update.'),
  },
  async ({ address, password, name, type, builderCode, wallet, uri }) => {
    const result = await identity.register(config, {
      address, password, name, type, builderCode, wallet, uri,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

server.tool(
  'agent_update',
  'Update an existing agent\'s metadata (name, type, builder code), token URI, or linked wallet. Only the agent owner can update. Each field change is a separate on-chain transaction.',
  {
    address: injAddress.describe('Your inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the signing key.'),
    agentId: z.string().min(1).describe('The numeric agent ID (from agent_register).'),
    name: z.string().min(1).optional().describe('New agent name.'),
    type: z.number().int().min(0).max(255).optional().describe('New agent type code.'),
    builderCode: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional()
      .describe('New builder identifier (bytes32).'),
    uri: z.string().optional().describe('New token URI (e.g., IPFS link).'),
    wallet: ethAddress.optional().describe('New linked EVM wallet address.'),
  },
  async ({ address, password, agentId, name, type, builderCode, uri, wallet }) => {
    const result = await identity.update(config, {
      address, password, agentId, name, type, builderCode, uri, wallet,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

server.tool(
  'agent_deregister',
  'Permanently burn an agent\'s identity NFT. This is IRREVERSIBLE. The agent loses its on-chain identity, reputation, and discoverability. Requires confirm=true.',
  {
    address: injAddress.describe('Your inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the signing key.'),
    agentId: z.string().min(1).describe('The numeric agent ID to deregister.'),
    confirm: z.boolean().describe('Must be true to proceed. This action is irreversible.'),
  },
  async ({ address, password, agentId, confirm }) => {
    const result = await identity.deregister(config, {
      address, password, agentId, confirm,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

server.tool(
  'agent_status',
  'Get complete information about a specific agent: metadata, linked wallet, owner address, token URI, and reputation score with feedback count. Read-only, no gas cost.',
  {
    agentId: z.string().min(1).describe('The numeric agent ID to look up.'),
  },
  async ({ agentId }) => {
    const result = await identityRead.status(config, { agentId })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

server.tool(
  'agent_list',
  'Find registered agents on Injective. Filter by owner address or agent type. Returns agent IDs with summary metadata. Read-only, no gas cost.',
  {
    owner: z.string().optional().describe('Filter by owner — accepts inj1... or 0x... address.'),
    type: z.number().int().min(0).max(255).optional().describe('Filter by agent type code.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max agents to return (default 20, max 100).'),
  },
  async ({ owner, type, limit }) => {
    const result = await identityRead.list(config, { owner, type, limit })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 4: Verify ALL existing tests pass**

Run: `npm test`
Expected: All tests pass (existing + new identity tests).

**Step 5: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(identity): register 5 ERC-8004 identity tools in MCP server"
```

---

## Task 12: Add Server Schema Tests for Identity Tools

**Files:**
- Modify: `src/mcp/server.test.ts`

The existing `server.test.ts` tests Zod schemas used in tool registration. Add tests for the identity-specific schemas.

**Step 1: Read existing server.test.ts**

**Step 2: Add schema tests**

```typescript
describe('identity tool schemas', () => {
  const builderCodeSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/)

  describe('builderCode (bytes32)', () => {
    it('accepts valid 32-byte hex', () => {
      expect(builderCodeSchema.safeParse('0x' + 'ab'.repeat(32)).success).toBe(true)
    })

    it('rejects short hex', () => {
      expect(builderCodeSchema.safeParse('0xabcd').success).toBe(false)
    })

    it('rejects missing 0x prefix', () => {
      expect(builderCodeSchema.safeParse('ab'.repeat(32)).success).toBe(false)
    })
  })

  describe('ethAddress', () => {
    it('accepts valid checksummed address', () => {
      const addr = '0x' + 'aB'.repeat(20)
      expect(ethAddress.safeParse(addr).success).toBe(true)
    })

    it('rejects short address', () => {
      expect(ethAddress.safeParse('0xabcd').success).toBe(false)
    })
  })
})
```

**Step 3: Run tests**

Run: `npx vitest run src/mcp/server.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/mcp/server.test.ts
git commit -m "test(identity): add schema validation tests for identity tool params"
```

---

## Task 13: Integration Test on Injective EVM Testnet

**Files:**
- Create: `src/integration/identity.integration.test.ts`

This test hits the real Injective EVM testnet. It requires `INJECTIVE_PRIVATE_KEY` env var.

**Step 1: Write the integration test**

```typescript
// src/integration/identity.integration.test.ts
import { describe, it, expect } from 'vitest'
import { createConfig, validateNetwork } from '../config/index.js'
import { identity } from '../identity/index.js'
import { identityRead } from '../identity/read.js'
import { wallets } from '../wallets/index.js'
import { getTestPrivateKey, getTestNetwork, TX_HASH_RE } from '../test-utils/index.js'

// These tests are ONLY run via: npm run test:integration
// They require INJECTIVE_PRIVATE_KEY env var and testnet gas.

const network = getTestNetwork()
const config = createConfig(network)

describe('identity integration', () => {
  const testPassword = 'integration-test-password-8004'
  let testAddress: string
  let agentId: string

  // Import test wallet before all tests
  it('sets up test wallet', () => {
    const pk = getTestPrivateKey()
    const result = wallets.import(pk, testPassword, 'identity-integration-test')
    testAddress = result.address
    expect(testAddress).toMatch(/^inj1/)
  })

  it('registers an agent', async () => {
    const result = await identity.register(config, {
      address: testAddress,
      password: testPassword,
      name: 'IntegrationTestBot',
      type: 1,
      builderCode: '0x' + '00'.repeat(31) + '01',
      wallet: result.evmAddress, // Link to own EVM address
      uri: '',
    })

    expect(result.txHash).toMatch(TX_HASH_RE)
    expect(result.agentId).toBeDefined()
    agentId = result.agentId
  }, 30_000)

  it('reads agent status', async () => {
    const result = await identityRead.status(config, { agentId })

    expect(result.agentId).toBe(agentId)
    expect(result.name).toBe('IntegrationTestBot')
    expect(result.agentType).toBe(1)
    expect(result.owner).toMatch(/^0x/)
  }, 15_000)

  it('updates agent name', async () => {
    const result = await identity.update(config, {
      address: testAddress,
      password: testPassword,
      agentId,
      name: 'UpdatedTestBot',
    })

    expect(result.txHashes).toHaveLength(1)
    expect(result.txHashes[0]).toMatch(TX_HASH_RE)

    // Verify the update
    const status = await identityRead.status(config, { agentId })
    expect(status.name).toBe('UpdatedTestBot')
  }, 30_000)

  it('lists agents (includes our agent)', async () => {
    const result = await identityRead.list(config, { limit: 50 })

    expect(result.agents.length).toBeGreaterThan(0)
    const found = result.agents.find(a => a.agentId === agentId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('UpdatedTestBot')
  }, 30_000)

  it('deregisters the agent', async () => {
    const result = await identity.deregister(config, {
      address: testAddress,
      password: testPassword,
      agentId,
      confirm: true,
    })

    expect(result.txHash).toMatch(TX_HASH_RE)
    expect(result.agentId).toBe(agentId)
  }, 30_000)

  // Cleanup
  it('cleans up test wallet', () => {
    wallets.remove(testAddress)
  })
})
```

**Step 2: Run integration test (manual)**

Run: `INJECTIVE_PRIVATE_KEY=0x... npm run test:integration -- --testPathPattern identity`
Expected: All 6 tests pass. Each write test completes within 30s timeout.

**Step 3: Commit**

```bash
git add src/integration/identity.integration.test.ts
git commit -m "test(identity): add integration tests for ERC-8004 identity tools"
```

---

## Task 14: Verify Full Test Suite and Build

**Files:** None (verification only)

**Step 1: Run all unit tests**

Run: `npm test`
Expected: ALL tests pass — existing (trading, transfers, etc.) + new (identity).

**Step 2: Typecheck**

Run: `npm run typecheck`
Expected: No type errors.

**Step 3: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 4: Verify tool count**

Run: `grep -c "server.tool(" src/mcp/server.ts`
Expected: Previous count + 5 (the 5 new identity tools).

**Step 5: Commit (if any fixups needed)**

---

## Task 15: Update README

**Files:**
- Modify: `README.md`

**Step 1: Read current README**

**Step 2: Add identity tools section**

Add a new section to the tools table in README.md:

```markdown
### Identity Tools (ERC-8004)

| Tool | Description | Gas |
|------|-------------|-----|
| `agent_register` | Register a new AI agent identity | Yes |
| `agent_update` | Update agent metadata, URI, or wallet | Yes |
| `agent_deregister` | Permanently burn agent identity (irreversible) | Yes |
| `agent_status` | Get full agent details + reputation | No |
| `agent_list` | Find registered agents with filters | No |
```

Also update the total tool count at the top if mentioned, and add `viem` and `bech32` to the dependencies section if one exists.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add ERC-8004 identity tools to README"
```

---

## Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | Add viem + bech32 deps | `package.json` | Existing pass |
| 2 | Identity config | `src/identity/config.ts` | 3 unit tests |
| 3 | Contract ABIs | `src/identity/abis.ts` | Typecheck only |
| 4 | Error classes | `src/errors/index.ts` | 4 unit tests |
| 5 | Viem client factory | `src/identity/client.ts` | 3 unit tests |
| 6 | Write handlers (register/update/deregister) | `src/identity/index.ts` | 3 unit tests |
| 7 | Test agent_update | `src/identity/identity.test.ts` | 3 unit tests |
| 8 | Test agent_deregister | `src/identity/identity.test.ts` | 2 unit tests |
| 9 | agent_status handler | `src/identity/read.ts` | 1 unit test |
| 10 | Test agent_list | `src/identity/read.test.ts` | 3 unit tests |
| 11 | Register 5 tools in server.ts | `src/mcp/server.ts` | Build + existing |
| 12 | Server schema tests | `src/mcp/server.test.ts` | 4 unit tests |
| 13 | Integration test | `src/integration/identity.integration.test.ts` | 6 integration tests |
| 14 | Full verification | — | All tests + build |
| 15 | Update README | `README.md` | — |

**Total new files:** 7 (`config.ts`, `abis.ts`, `client.ts`, `index.ts`, `read.ts`, plus test files)
**Total modified files:** 3 (`errors/index.ts`, `mcp/server.ts`, `README.md`)
**Total new test cases:** ~26 unit + 6 integration
**Estimated commits:** 15

---

## Open Items for Implementer

1. **Contract ABIs:** The ABIs in Task 3 are minimal placeholders based on the ERC-8004 interface. Before implementation, copy the full ABIs from `InjectiveLabs/injective-agent-cli` at `packages/sdk/src/abis/`. The function signatures must match exactly.

2. **Contract addresses:** All addresses in `config.ts` are placeholders (`0x000...001`). Replace with actual deployed addresses from the agent-sdk config before any integration testing.

3. **Mainnet chain ID:** Verify whether mainnet EVM JSON-RPC uses chain ID `1776` (per existing config) or `2525` (per PRD). Test by querying `eth_chainId` on `https://json-rpc.injective.network`.

4. **Deploy block:** Set the actual deploy block in `config.ts` to avoid scanning from genesis. This dramatically speeds up `agent_list`.

5. **Event scanning performance (open question from PRD):** The `agent_list` implementation scans Transfer events from deploy block. If this proves slow, apply the same in-memory TTL cache pattern used by `src/client/index.ts` (5-minute TTL).
