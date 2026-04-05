# Converge Identity Module onto @injective/agent-sdk — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the MCP server's `src/identity/` internals with imports from `@injective/agent-sdk`, reducing the module to a thin adapter layer (~200 lines) that handles keystore unlock and MCP response formatting.

**Architecture:** Two adapter files (`index.ts`, `read.ts`) delegate to `AgentClient` / `AgentReadClient` from the SDK. All ABIs, card logic, storage, helpers, config, and types come from the SDK. The MCP server adds only keystore unlock and JSON shape formatting.

**Tech Stack:** `@injective/agent-sdk` (built from `../injective-agent-cli`), `viem` (shared), TypeScript/ESM

---

## Critical Context: SDK Current State

The SDK repo (`/Users/dearkane/Documents/dev/inj/injective-agent-cli`) is currently a **CLI tool**, not a library. It has:

- ✅ Types, ABIs, card utilities, contract helpers, wallet signature, config
- ❌ No `AgentClient` or `AgentReadClient` classes
- ❌ No reputation methods (read or write)
- ❌ No agent discovery/listing
- ❌ No `StorageProvider` interface (uses direct Pinata calls)
- ❌ No library entry point or package exports
- ❌ Config reads from env vars (`INJ_NETWORK`, `INJ_PRIVATE_KEY`), not constructor params

**The plan has two parts:**
- **Part 1** (Tasks 1–9): Build the SDK library layer in `injective-agent-cli`
- **Part 2** (Tasks 10–15): Refactor MCP server to use the SDK

---

## SDK ↔ MCP Type Mapping Reference

| SDK Type | MCP Type | Adapter Conversion |
|----------|----------|--------------------|
| `agentId: bigint` | `agentId: string` | `.toString()` |
| `txHashes: \`0x${string}\`[]` | `txHash: string` | `txHashes[0]` |
| `StatusResult.type` | `agentType` | rename field |
| `StatusResult.wallet` | `linkedWallet` | rename field |
| `StatusResult.tokenUri` | `tokenURI` | rename field (case) |
| `reputation.score: number` | `reputation.score: string` (in status) | `String()` |
| `reputation.count: number` | `reputation.count: string` (in status) | `String()` |
| `FeedbackEntry.feedbackIndex: bigint` | `feedbackIndex: number` | `Number()` |
| `FeedbackEntry.value: bigint` | `value: number` | normalize by decimals |
| `FeedbackEntry.tags: [string, string]` | `tag1, tag2` | destructure |

---

## Part 1: SDK Library Layer

> All tasks in Part 1 are in the **`/Users/dearkane/Documents/dev/inj/injective-agent-cli`** repo.

### Task 1: Add library entry point and package exports

**Files:**
- Create: `src/sdk/index.ts`
- Modify: `package.json`
- Modify: `tsconfig.json` (if needed for new entry point)

**Step 1: Create SDK entry point**

```typescript
// src/sdk/index.ts

// ── Client classes ──
export { AgentClient } from './agent-client.js'
export type { AgentClientConfig } from './agent-client.js'
export { AgentReadClient } from './agent-read-client.js'
export type { ReadClientConfig } from './agent-read-client.js'

// ── Storage ──
export { PinataStorage, CustomUrlStorage } from './storage.js'
export type { StorageProvider } from './storage.js'

// ── Types ──
export type {
  AgentType, ServiceType, ServiceEntry, AgentCard,
  RegisterOptions, RegisterResult,
  UpdateOptions, UpdateResult,
  DeregisterOptions, DeregisterResult,
  StatusResult, NetworkConfig,
} from '../types/index.js'
export { AGENT_TYPES, SERVICE_TYPES, AGENT_CARD_TYPE } from '../types/index.js'

// ── Card utilities ──
export { generateAgentCard, mergeAgentCard, fetchAgentCard } from '../lib/agent-card.js'

// ── Contract utilities ──
export {
  encodeStringMetadata, decodeStringMetadata, walletLinkDeadline, identityTuple,
} from '../lib/contracts.js'

// ── Wallet ──
export { signWalletLink } from '../lib/wallet-signature.js'
export { evmToInj } from '../lib/keys.js'

// ── Config ──
export { resolveNetworkConfig, TESTNET, MAINNET } from './config.js'

// ── Errors ──
export {
  AgentSdkError, ContractError, ValidationError, StorageError, SimulationError,
} from './errors.js'

// ── ABIs ──
export { default as IdentityRegistryABI } from '../abi/IdentityRegistry.json' with { type: 'json' }
export { default as ReputationRegistryABI } from '../abi/ReputationRegistry.json' with { type: 'json' }
```

**Step 2: Update package.json**

Add `exports` field and rename package:

```json
{
  "name": "@injective/agent-sdk",
  "exports": {
    ".": {
      "import": "./dist/sdk/index.js",
      "types": "./dist/sdk/index.d.ts"
    }
  }
}
```

Keep `"bin"` entry for CLI usage. The package serves both as CLI and library.

**Step 3: Verify build**

```bash
cd /Users/dearkane/Documents/dev/inj/injective-agent-cli && npm run build
```

**Step 4: Commit**

```bash
git add src/sdk/index.ts package.json
git commit -m "feat: add SDK library entry point and package exports"
```

---

### Task 2: Create StorageProvider interface and PinataStorage class

**Files:**
- Create: `src/sdk/storage.ts`
- Existing reference: `src/lib/ipfs.ts` (current Pinata upload logic)

**Step 1: Write storage module**

```typescript
// src/sdk/storage.ts

export interface StorageProvider {
  uploadJSON(data: unknown, name?: string): Promise<string>
}

export class StorageError extends Error {
  readonly code = 'STORAGE_ERROR'
  constructor(reason: string) {
    super(reason)
    this.name = 'StorageError'
  }
}

const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS'

export class PinataStorage implements StorageProvider {
  readonly #jwt: string
  constructor(opts: { jwt: string }) {
    this.#jwt = opts.jwt
  }

  async uploadJSON(data: unknown, name?: string): Promise<string> {
    let response: Response
    try {
      response = await fetch(PINATA_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#jwt}`,
        },
        body: JSON.stringify({
          pinataContent: data,
          pinataMetadata: { name: name ?? 'agent-card' },
          pinataOptions: { cidVersion: 1 },
        }),
      })
    } catch (err) {
      throw new StorageError(`Pinata upload failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new StorageError(`Pinata returned ${response.status}: ${body.slice(0, 200)}`)
    }
    const result = (await response.json()) as { IpfsHash?: string }
    if (!result.IpfsHash) throw new StorageError('Pinata response missing IpfsHash')
    return `ipfs://${result.IpfsHash}`
  }
}

/**
 * Storage provider that always returns a fixed URI. Useful when the caller
 * already has a hosted card and doesn't need IPFS upload.
 */
export class CustomUrlStorage implements StorageProvider {
  readonly #uri: string
  constructor(uri: string) {
    this.#uri = uri
  }
  async uploadJSON(): Promise<string> {
    return this.#uri
  }
}
```

**Step 2: Commit**

```bash
git add src/sdk/storage.ts
git commit -m "feat(sdk): add StorageProvider interface, PinataStorage, CustomUrlStorage"
```

---

### Task 3: Create parameterized config and error types

**Files:**
- Create: `src/sdk/config.ts`
- Create: `src/sdk/errors.ts`
- Existing reference: `src/lib/config.ts`, `src/lib/errors.ts`

**Step 1: Write parameterized config**

```typescript
// src/sdk/config.ts
import type { NetworkConfig } from '../types/index.js'

export const TESTNET: NetworkConfig = {
  name: 'testnet',
  chainId: 1439,
  rpcUrl: 'https://testnet.sentry.chain.json-rpc.injective.network',
  identityRegistry: '0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e',
  reputationRegistry: '0x019b24a73d493d86c61cc5dfea32e4865eecb922',
  validationRegistry: '0xbd84e152f41e28d92437b4b822b77e7e31bfd2a4',
  ipfsGateway: 'https://w3s.link/ipfs/',
}

export const MAINNET: NetworkConfig = {
  name: 'mainnet',
  chainId: 2525,
  rpcUrl: 'https://evm.injective.network',
  identityRegistry: '0x0000000000000000000000000000000000000000',
  reputationRegistry: '0x0000000000000000000000000000000000000000',
  validationRegistry: '0x0000000000000000000000000000000000000000',
  ipfsGateway: 'https://w3s.link/ipfs/',
}

export interface ResolveConfigOptions {
  network?: 'testnet' | 'mainnet'
  rpcUrl?: string
  ipfsGateway?: string   // GAP-01: allow override
}

export function resolveNetworkConfig(opts?: ResolveConfigOptions): NetworkConfig {
  const network = opts?.network ?? 'testnet'
  if (network === 'mainnet' && MAINNET.identityRegistry === '0x0000000000000000000000000000000000000000') {
    throw new Error('Mainnet contracts are not yet deployed. Use network: "testnet".')
  }
  const base = network === 'mainnet' ? MAINNET : TESTNET
  return {
    ...base,
    ...(opts?.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    ...(opts?.ipfsGateway ? { ipfsGateway: opts.ipfsGateway } : {}),
  }
}
```

**Step 2: Write SDK error types**

```typescript
// src/sdk/errors.ts

export class AgentSdkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSdkError'
  }
}

export class ValidationError extends AgentSdkError {
  readonly code = 'VALIDATION_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ContractError extends AgentSdkError {
  readonly code = 'CONTRACT_ERROR'
  readonly revertReason?: string
  constructor(message: string, revertReason?: string) {
    super(message)
    this.name = 'ContractError'
    this.revertReason = revertReason
  }
}

export class SimulationError extends AgentSdkError {
  readonly code = 'SIMULATION_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'SimulationError'
  }
}

// Re-export StorageError from storage module
export { StorageError } from './storage.js'

export function formatContractError(error: unknown): ContractError {
  if (error instanceof ContractError) return error
  const msg = error instanceof Error ? error.message : String(error)
  // Extract revert reason from viem ContractFunctionExecutionError
  const revertMatch = msg.match(/reverted with.*?:\s*(.+)/i)
  return new ContractError(msg, revertMatch?.[1])
}
```

**Step 3: Commit**

```bash
git add src/sdk/config.ts src/sdk/errors.ts
git commit -m "feat(sdk): add parameterized config resolver and typed errors"
```

---

### Task 4: Create AgentClient class (write operations)

**Files:**
- Create: `src/sdk/agent-client.ts`
- Existing reference: `src/commands/register.ts`, `src/commands/update.ts`, `src/commands/deregister.ts`

The `AgentClient` wraps write operations. It takes a `privateKey` (not env var) and optional `storage` provider. Each method encapsulates the full transaction flow (simulate → broadcast → extract events).

**Step 1: Write AgentClient**

```typescript
// src/sdk/agent-client.ts
import {
  createPublicClient, createWalletClient, http, getContract,
  keccak256, toHex, type PublicClient, type WalletClient, type GetContractReturnType,
} from 'viem'
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts'
import type {
  NetworkConfig, RegisterOptions, RegisterResult,
  UpdateOptions, UpdateResult, DeregisterResult, StatusResult,
} from '../types/index.js'
import type { StorageProvider } from './storage.js'
import { resolveNetworkConfig, type ResolveConfigOptions } from './config.js'
import { encodeStringMetadata, decodeStringMetadata, walletLinkDeadline, identityTuple } from '../lib/contracts.js'
import { generateAgentCard, mergeAgentCard, fetchAgentCard } from '../lib/agent-card.js'
import { signWalletLink } from '../lib/wallet-signature.js'
import { ContractError, formatContractError, ValidationError } from './errors.js'
import { evmToInj } from '../lib/keys.js'
import IdentityRegistryABI from '../abi/IdentityRegistry.json' with { type: 'json' }
import ReputationRegistryABI from '../abi/ReputationRegistry.json' with { type: 'json' }

const REGISTERED_EVENT_TOPIC = keccak256(toHex('Registered(uint256,string,address)'))
const NEW_FEEDBACK_EVENT_TOPIC = keccak256(toHex('NewFeedback(uint256,address,uint256)'))

export interface AgentClientConfig extends ResolveConfigOptions {
  privateKey: `0x${string}`
  storage?: StorageProvider
  audit?: boolean          // default false for library usage
}

export interface GiveFeedbackOptions {
  agentId: bigint
  value: bigint
  valueDecimals?: number
  tag1?: string
  tag2?: string
  endpoint?: string
  feedbackURI?: string
  feedbackHash?: `0x${string}`
}

export interface GiveFeedbackResult {
  txHash: `0x${string}`
  agentId: bigint
  feedbackIndex: bigint
}

export interface RevokeFeedbackOptions {
  agentId: bigint
  feedbackIndex: bigint
}

export interface RevokeFeedbackResult {
  txHash: `0x${string}`
  agentId: bigint
}

export class AgentClient {
  readonly address: `0x${string}`
  readonly injAddress: string
  readonly config: NetworkConfig

  readonly #account: LocalAccount
  readonly #publicClient: PublicClient
  readonly #walletClient: WalletClient
  readonly #identityRegistry: GetContractReturnType
  readonly #storage?: StorageProvider

  constructor(opts: AgentClientConfig) {
    const key = opts.privateKey.startsWith('0x') ? opts.privateKey : `0x${opts.privateKey}` as `0x${string}`
    this.#account = privateKeyToAccount(key)
    this.address = this.#account.address
    this.injAddress = evmToInj(this.address)
    this.config = resolveNetworkConfig(opts)
    this.#storage = opts.storage

    const chain = {
      id: this.config.chainId,
      name: this.config.name,
      nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
      rpcUrls: { default: { http: [this.config.rpcUrl] } },
    }
    this.#publicClient = createPublicClient({ chain, transport: http(this.config.rpcUrl) }) as PublicClient
    this.#walletClient = createWalletClient({ chain, account: this.#account, transport: http(this.config.rpcUrl) }) as WalletClient
    this.#identityRegistry = getContract({
      address: this.config.identityRegistry,
      abi: IdentityRegistryABI,
      client: { public: this.#publicClient, wallet: this.#walletClient },
    })
  }

  async register(opts: RegisterOptions): Promise<RegisterResult> {
    const card = generateAgentCard({
      name: opts.name,
      type: opts.type,
      description: opts.description,
      builderCode: opts.builderCode,
      operatorAddress: this.address,
      services: opts.services,
      image: opts.image,
      chainId: this.config.chainId,
    })

    let cardUri: string
    if (opts.uri) {
      cardUri = opts.uri
    } else if (!this.#storage) {
      throw new ValidationError('No storage provider configured and no uri provided.')
    } else {
      cardUri = await this.#storage.uploadJSON(card, `agent-card-${card.name.toLowerCase().replace(/\s+/g, '-')}`)
    }

    let nonce = await this.#publicClient.getTransactionCount({ address: this.address, blockTag: 'pending' })
    const txHashes: `0x${string}`[] = []

    try {
      const metadata = [
        { metadataKey: 'builderCode', metadataValue: encodeStringMetadata(opts.builderCode) },
        { metadataKey: 'agentType', metadataValue: encodeStringMetadata(opts.type) },
      ]
      const registerHash = await this.#walletClient.writeContract({
        address: this.config.identityRegistry,
        abi: IdentityRegistryABI,
        functionName: 'register',
        args: [cardUri, metadata],
        nonce: nonce++,
        gas: 500_000n,
      })
      txHashes.push(registerHash)
      const receipt = await this.#publicClient.waitForTransactionReceipt({ hash: registerHash })

      const registeredLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === this.config.identityRegistry.toLowerCase() &&
          log.topics[0] === REGISTERED_EVENT_TOPIC,
      )
      if (!registeredLog?.topics[1]) throw new ContractError('Failed to extract agentId from register transaction.')
      const agentId = BigInt(registeredLog.topics[1])

      // Wallet link (self-sign only)
      if (opts.wallet.toLowerCase() === this.address.toLowerCase()) {
        const deadline = walletLinkDeadline()
        const sig = await signWalletLink({
          agentId,
          wallet: opts.wallet,
          ownerAddress: this.address,
          deadline,
          account: this.#account,
          chainId: this.config.chainId,
          contractAddress: this.config.identityRegistry,
        })
        const walletHash = await this.#walletClient.writeContract({
          address: this.config.identityRegistry,
          abi: IdentityRegistryABI,
          functionName: 'setAgentWallet',
          args: [agentId, opts.wallet, deadline, sig],
          nonce: nonce++,
          gas: 300_000n,
        })
        txHashes.push(walletHash)
        await this.#publicClient.waitForTransactionReceipt({ hash: walletHash })
      }

      const tuple = identityTuple(this.config, agentId)
      return {
        agentId,
        identityTuple: tuple,
        cardUri,
        txHashes,
        scanUrl: `https://8004scan.io/agent/${tuple}`,
      }
    } catch (error) {
      if (error instanceof ContractError || error instanceof ValidationError) throw error
      throw formatContractError(error)
    }
  }

  async update(agentId: bigint, opts: UpdateOptions): Promise<UpdateResult> {
    // See src/commands/update.ts for full logic to port.
    // Key steps: detect card-level changes, fetch existing card, merge,
    // upload if changed, setMetadata for name/type/builderCode, setAgentURI,
    // setAgentWallet if wallet provided.
    //
    // Implementation should follow the same nonce-ordered pattern as register().
    // Return { agentId, updatedFields, txHashes, cardUri? }.
    throw new Error('TODO: implement — port from src/commands/update.ts')
  }

  async deregister(agentId: bigint): Promise<DeregisterResult> {
    try {
      const hash = await this.#walletClient.writeContract({
        address: this.config.identityRegistry,
        abi: IdentityRegistryABI,
        functionName: 'deregister',
        args: [agentId],
        gas: 200_000n,
      })
      await this.#publicClient.waitForTransactionReceipt({ hash })
      return { agentId, txHash: hash }
    } catch (error) {
      throw formatContractError(error)
    }
  }

  async giveFeedback(opts: GiveFeedbackOptions): Promise<GiveFeedbackResult> {
    const feedbackHash = opts.feedbackHash ?? ('0x' + '00'.repeat(32)) as `0x${string}`
    try {
      const hash = await this.#walletClient.writeContract({
        address: this.config.reputationRegistry,
        abi: ReputationRegistryABI,
        functionName: 'giveFeedback',
        args: [
          opts.agentId,
          opts.value,
          opts.valueDecimals ?? 0,
          opts.tag1 ?? '',
          opts.tag2 ?? '',
          opts.endpoint ?? '',
          opts.feedbackURI ?? '',
          feedbackHash,
        ],
        gas: 300_000n,
      })
      const receipt = await this.#publicClient.waitForTransactionReceipt({ hash })

      // Extract feedbackIndex from NewFeedback event
      const feedbackLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === this.config.reputationRegistry.toLowerCase() &&
          log.topics[0] === NEW_FEEDBACK_EVENT_TOPIC,
      )
      const feedbackIndex = feedbackLog?.data ? BigInt(feedbackLog.data) : 0n

      return { txHash: hash, agentId: opts.agentId, feedbackIndex }
    } catch (error) {
      throw formatContractError(error)
    }
  }

  async revokeFeedback(opts: RevokeFeedbackOptions): Promise<RevokeFeedbackResult> {
    try {
      const hash = await this.#walletClient.writeContract({
        address: this.config.reputationRegistry,
        abi: ReputationRegistryABI,
        functionName: 'revokeFeedback',
        args: [opts.agentId, opts.feedbackIndex],
        gas: 200_000n,
      })
      await this.#publicClient.waitForTransactionReceipt({ hash })
      return { txHash: hash, agentId: opts.agentId }
    } catch (error) {
      throw formatContractError(error)
    }
  }

  /** Convenience read — delegates to a temporary read client */
  async getStatus(agentId: bigint): Promise<StatusResult> {
    const { AgentReadClient } = await import('./agent-read-client.js')
    const reader = new AgentReadClient({ network: this.config.name as 'testnet' | 'mainnet', rpcUrl: this.config.rpcUrl })
    return reader.getStatus(agentId)
  }
}
```

> **Note:** The `update()` method body is marked TODO — the implementing agent should port from `src/commands/update.ts`, following the same nonce-ordered setMetadata → setAgentURI → setAgentWallet pattern with card merge logic. The return type should include `cardUri?: string` (add to `UpdateResult` in `types/index.ts`).

**Step 2: Run build**

```bash
npm run build
```

Expected: compiles with the TODO runtime error only (no type errors)

**Step 3: Commit**

```bash
git add src/sdk/agent-client.ts
git commit -m "feat(sdk): add AgentClient class with register, deregister, giveFeedback, revokeFeedback"
```

---

### Task 5: Implement AgentClient.update()

**Files:**
- Modify: `src/sdk/agent-client.ts` (fill in `update()` method)
- Modify: `src/types/index.ts` (add `cardUri?: string` to `UpdateResult`)
- Reference: `src/commands/update.ts` (existing CLI implementation)

**Step 1: Add cardUri to UpdateResult**

In `src/types/index.ts`, add to `UpdateResult`:
```typescript
export interface UpdateResult {
  agentId: bigint;
  updatedFields: string[];
  txHashes: `0x${string}`[];
  cardUri?: string;        // ← add this
}
```

**Step 2: Implement update() in agent-client.ts**

Port the logic from `src/commands/update.ts`. Key pattern:
1. Detect which fields changed (metadata vs card-level vs wallet)
2. Fetch existing card if card-level changes needed
3. Merge updates into existing card
4. Upload merged card via storage provider
5. Broadcast setMetadata txs (name, type, builderCode) sequentially for nonce ordering
6. Broadcast setAgentURI if card or uri changed
7. Wait for all receipts
8. Link wallet if provided (self-sign only)
9. Return `{ agentId, updatedFields, txHashes, cardUri }`

**Step 3: Run build and test**

```bash
npm run build && npm test
```

**Step 4: Commit**

```bash
git commit -am "feat(sdk): implement AgentClient.update() with card merge"
```

---

### Task 6: Create AgentReadClient class (status + discovery)

**Files:**
- Create: `src/sdk/agent-read-client.ts`
- Reference: MCP server's `src/identity/read.ts` (lines 92–291)

**Step 1: Write AgentReadClient with status and listing**

```typescript
// src/sdk/agent-read-client.ts
import {
  createPublicClient, http, zeroAddress, type PublicClient,
} from 'viem'
import type { NetworkConfig, StatusResult } from '../types/index.js'
import { resolveNetworkConfig, type ResolveConfigOptions } from './config.js'
import { decodeStringMetadata } from '../lib/contracts.js'
import { fetchAgentCard } from '../lib/agent-card.js'
import IdentityRegistryABI from '../abi/IdentityRegistry.json' with { type: 'json' }
import ReputationRegistryABI from '../abi/ReputationRegistry.json' with { type: 'json' }

export interface ReadClientConfig {
  network?: 'testnet' | 'mainnet'
  rpcUrl?: string
  ipfsGateway?: string
}

export interface ReputationResult {
  score: number
  count: number
  clients: `0x${string}`[]
}

export interface FeedbackEntry {
  client: `0x${string}`
  feedbackIndex: bigint
  value: bigint
  decimals: number
  tags: [string, string]
  revoked: boolean
}

export interface EnrichedAgentResult extends StatusResult {
  reputation: ReputationResult
}

export interface ListAgentsResult {
  agents: StatusResult[]
  total: number
}

export class AgentReadClient {
  readonly config: NetworkConfig
  readonly #publicClient: PublicClient

  constructor(opts?: ReadClientConfig) {
    this.config = resolveNetworkConfig(opts)
    const chain = {
      id: this.config.chainId,
      name: this.config.name,
      nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
      rpcUrls: { default: { http: [this.config.rpcUrl] } },
    }
    this.#publicClient = createPublicClient({ chain, transport: http(this.config.rpcUrl) }) as PublicClient
  }

  async getStatus(agentId: bigint): Promise<StatusResult> {
    const [nameRaw, builderCodeRaw, agentTypeRaw, owner, tokenUri, wallet] = await Promise.all([
      this.#readMetadata(agentId, 'name'),
      this.#readMetadata(agentId, 'builderCode'),
      this.#readMetadata(agentId, 'agentType'),
      this.#publicClient.readContract({
        address: this.config.identityRegistry, abi: IdentityRegistryABI,
        functionName: 'ownerOf', args: [agentId],
      }) as Promise<`0x${string}`>,
      this.#publicClient.readContract({
        address: this.config.identityRegistry, abi: IdentityRegistryABI,
        functionName: 'tokenURI', args: [agentId],
      }) as Promise<string>,
      this.#publicClient.readContract({
        address: this.config.identityRegistry, abi: IdentityRegistryABI,
        functionName: 'getAgentWallet', args: [agentId],
      }) as Promise<`0x${string}`>,
    ])

    return {
      agentId,
      name: decodeStringMetadata(nameRaw) || `Agent ${agentId}`,
      type: decodeStringMetadata(agentTypeRaw),
      owner,
      wallet,
      builderCode: decodeStringMetadata(builderCodeRaw),
      tokenUri,
      identityTuple: `eip155:${this.config.chainId}:${this.config.identityRegistry}:${agentId}`,
    }
  }

  async getEnrichedAgent(agentId: bigint): Promise<EnrichedAgentResult> {
    const [status, reputation] = await Promise.all([
      this.getStatus(agentId),
      this.getReputation(agentId).catch(() => ({ score: 0, count: 0, clients: [] })),
    ])
    return { ...status, reputation }
  }

  async listAgents(opts?: { limit?: number }): Promise<ListAgentsResult> {
    const limit = opts?.limit ?? 20
    // Discover agent IDs via Transfer events (mint = from zero address)
    const logs = await this.#publicClient.getLogs({
      address: this.config.identityRegistry,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { name: 'from', type: 'address', indexed: true },
          { name: 'to', type: 'address', indexed: true },
          { name: 'tokenId', type: 'uint256', indexed: true },
        ],
      },
      args: { from: zeroAddress },
      fromBlock: 0n,
      toBlock: 'latest',
    })

    const agentIds = logs.map((log) => BigInt(log.topics[3]!))
    const statuses = await Promise.all(
      agentIds.slice(0, limit).map((id) => this.getStatus(id).catch(() => null)),
    )

    return {
      agents: statuses.filter((s): s is StatusResult => s !== null),
      total: agentIds.length,
    }
  }

  async getAgentsByOwner(owner: `0x${string}`, opts?: { limit?: number }): Promise<ListAgentsResult> {
    const limit = opts?.limit ?? 20
    const logs = await this.#publicClient.getLogs({
      address: this.config.identityRegistry,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { name: 'from', type: 'address', indexed: true },
          { name: 'to', type: 'address', indexed: true },
          { name: 'tokenId', type: 'uint256', indexed: true },
        ],
      },
      args: { from: zeroAddress },
      fromBlock: 0n,
      toBlock: 'latest',
    })

    const agentIds = logs.map((log) => BigInt(log.topics[3]!))

    // Filter by current owner (ownership may have changed since mint)
    const candidates = await Promise.all(
      agentIds.map(async (id) => {
        try {
          const currentOwner = (await this.#publicClient.readContract({
            address: this.config.identityRegistry,
            abi: IdentityRegistryABI,
            functionName: 'ownerOf',
            args: [id],
          })) as `0x${string}`
          return currentOwner.toLowerCase() === owner.toLowerCase() ? id : null
        } catch {
          return null // burned
        }
      }),
    )
    const ownedIds = candidates.filter((id): id is bigint => id !== null)

    const statuses = await Promise.all(
      ownedIds.slice(0, limit).map((id) => this.getStatus(id).catch(() => null)),
    )

    return {
      agents: statuses.filter((s): s is StatusResult => s !== null),
      total: ownedIds.length,
    }
  }

  async getReputation(agentId: bigint, opts?: {
    clientAddresses?: `0x${string}`[]
    tag1?: string
    tag2?: string
  }): Promise<ReputationResult> {
    const clients = opts?.clientAddresses?.length
      ? opts.clientAddresses
      : await this.getClients(agentId)

    if (clients.length === 0) return { score: 0, count: 0, clients: [] }

    const [count, summaryValue, decimals] = (await this.#publicClient.readContract({
      address: this.config.reputationRegistry,
      abi: ReputationRegistryABI,
      functionName: 'getSummary',
      args: [agentId, clients, opts?.tag1 ?? '', opts?.tag2 ?? ''],
    })) as [bigint, bigint, bigint]

    const countNum = Number(count)
    const score = countNum > 0
      ? Math.round((Number(summaryValue) / Math.pow(10, Number(decimals)) / countNum) * 100) / 100
      : 0

    return { score, count: countNum, clients }
  }

  async getClients(agentId: bigint): Promise<`0x${string}`[]> {
    return (await this.#publicClient.readContract({
      address: this.config.reputationRegistry,
      abi: ReputationRegistryABI,
      functionName: 'getClients',
      args: [agentId],
    })) as `0x${string}`[]
  }

  async getFeedbackEntries(agentId: bigint, opts?: {
    clientAddresses?: `0x${string}`[]
    tag1?: string
    tag2?: string
    includeRevoked?: boolean
  }): Promise<FeedbackEntry[]> {
    const clients = opts?.clientAddresses?.length
      ? opts.clientAddresses
      : await this.getClients(agentId)

    if (clients.length === 0) return []

    const result = (await this.#publicClient.readContract({
      address: this.config.reputationRegistry,
      abi: ReputationRegistryABI,
      functionName: 'readAllFeedback',
      args: [
        agentId,
        clients,
        opts?.tag1 ?? '',
        opts?.tag2 ?? '',
        opts?.includeRevoked ?? false,
      ],
    })) as [
      `0x${string}`[],  // clientAddresses
      bigint[],          // feedbackIndexes
      bigint[],          // values
      bigint[],          // valueDecimals
      string[],          // tag1s
      string[],          // tag2s
      boolean[],         // revoked flags
    ]

    const [clientAddrs, indexes, values, valueDecimals, tag1s, tag2s, revokeds] = result
    return clientAddrs.map((client, i) => ({
      client,
      feedbackIndex: indexes[i],
      value: values[i],
      decimals: Number(valueDecimals[i]),
      tags: [tag1s[i], tag2s[i]] as [string, string],
      revoked: revokeds[i],
    }))
  }

  async #readMetadata(agentId: bigint, key: string): Promise<`0x${string}`> {
    return (await this.#publicClient.readContract({
      address: this.config.identityRegistry,
      abi: IdentityRegistryABI,
      functionName: 'getMetadata',
      args: [agentId, key],
    })) as `0x${string}`
  }
}
```

**Step 2: Run build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/sdk/agent-read-client.ts
git commit -m "feat(sdk): add AgentReadClient with status, listing, reputation, feedback reads"
```

---

### Task 7: Update existing CLI commands to use SDK classes

**Files:**
- Modify: `src/commands/register.ts`
- Modify: `src/commands/update.ts`
- Modify: `src/commands/deregister.ts`
- Modify: `src/commands/status.ts`

Refactor each CLI command to use `AgentClient` / `AgentReadClient` instead of raw contract calls. This validates the SDK API works for real callers and eliminates duplication within the CLI repo itself.

**Step 1:** Rewrite `register.ts` to:
```typescript
import { AgentClient, PinataStorage } from '../sdk/index.js'
import { resolveKey } from '../lib/keys.js'
// ... create AgentClient with resolveKey().account.privateKey, delegate to client.register()
```

**Step 2:** Repeat for update, deregister, status.

**Step 3: Run full test suite**

```bash
npm test
```

**Step 4: Commit**

```bash
git commit -am "refactor: CLI commands use AgentClient/AgentReadClient internally"
```

---

### Task 8: Add SDK tests

**Files:**
- Create: `src/sdk/__tests__/agent-client.test.ts`
- Create: `src/sdk/__tests__/agent-read-client.test.ts`
- Create: `src/sdk/__tests__/storage.test.ts`

Write unit tests that mock viem clients and verify:
- `AgentClient` constructor derives correct address from private key
- `register()` calls writeContract with correct args and extracts agentId from event
- `giveFeedback()` / `revokeFeedback()` call correct ReputationRegistry methods
- `AgentReadClient.getStatus()` reads correct metadata keys
- `AgentReadClient.getReputation()` normalizes score correctly
- `AgentReadClient.getFeedbackEntries()` maps arrays to entry objects
- `PinataStorage.uploadJSON()` calls Pinata API and returns ipfs:// URI

**Step 1:** Write tests following vitest patterns already in the repo.

**Step 2: Run tests**

```bash
npm test
```

**Step 3: Commit**

```bash
git commit -am "test(sdk): add unit tests for AgentClient, AgentReadClient, PinataStorage"
```

---

### Task 9: Build and tag SDK release

**Step 1: Run full build and tests**

```bash
npm run build && npm test
```

**Step 2: Commit any remaining changes and tag**

```bash
git tag sdk-v0.1.0
git push origin HEAD --tags
```

The MCP server will reference this tag (or branch) as a git dependency.

---

## Part 2: MCP Adapter Refactor

> All tasks in Part 2 are in the **`/Users/dearkane/Documents/dev/inj/mcp-server`** repo.

### Task 10: Add @injective/agent-sdk dependency

**Files:**
- Modify: `package.json`

**Step 1: Add git dependency**

```bash
cd /Users/dearkane/Documents/dev/inj/mcp-server
npm install --save ../injective-agent-cli
```

This adds a `file:` dependency for local development. For CI/production, switch to:
```json
"@injective/agent-sdk": "github:InjectiveLabs/injective-agent-cli#sdk-v0.1.0"
```

**Step 2: Verify import**

Create a quick smoke test:
```bash
npx tsx -e "import { AgentClient, AgentReadClient, PinataStorage } from '@injective/agent-sdk'; console.log('OK')"
```

Expected: prints `OK`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @injective/agent-sdk dependency"
```

---

### Task 11: Rewrite read.ts as thin adapter

**Files:**
- Rewrite: `src/identity/read.ts`

This is the lowest-risk change — reads don't touch the keystore and don't broadcast transactions.

**Step 1: Write the read adapter**

```typescript
// src/identity/read.ts
import { AgentReadClient } from '@injective/agent-sdk'
import type { Config } from '../config/index.js'
import { evm } from '../evm/index.js'
import { IdentityNotFound, IdentityTxFailed } from '../errors/index.js'

// ── MCP Response Types (preserved exactly) ──

export interface StatusParams {
  agentId: string
}

export interface StatusResult {
  agentId: string
  name: string
  agentType: string
  builderCode: string
  owner: string
  tokenURI: string
  linkedWallet: string
  reputation: { score: string; count: string }
}

export interface ListParams {
  owner?: string
  type?: string
  limit?: number
}

export interface ListEntry {
  agentId: string
  name: string
  agentType: string
  owner: string
}

export interface ListResult {
  agents: ListEntry[]
  total: number
}

export interface ReputationParams {
  agentId: string
  clientAddresses?: string[]
  tag1?: string
  tag2?: string
}

export interface ReputationResult {
  agentId: string
  score: number
  count: number
  clients: string[]
}

export interface FeedbackListParams {
  agentId: string
  clientAddresses?: string[]
  tag1?: string
  tag2?: string
  includeRevoked?: boolean
}

export interface FeedbackEntry {
  client: string
  feedbackIndex: number
  value: number
  tag1: string
  tag2: string
  revoked: boolean
}

export interface FeedbackListResult {
  agentId: string
  entries: FeedbackEntry[]
}

// ── Read Client Cache ──

let cachedClient: { network: string; client: AgentReadClient } | undefined

function getReadClient(config: Config): AgentReadClient {
  if (cachedClient?.network === config.network) return cachedClient.client
  const client = new AgentReadClient({
    network: config.network as 'testnet' | 'mainnet',
    ipfsGateway: process.env['IPFS_GATEWAY'],
  })
  cachedClient = { network: config.network, client }
  return client
}

// ── Handlers ──

export const identityRead = {
  async status(config: Config, params: StatusParams): Promise<StatusResult> {
    const client = getReadClient(config)
    const agentId = BigInt(params.agentId)

    try {
      const enriched = await client.getEnrichedAgent(agentId)
      return {
        agentId: params.agentId,
        name: enriched.name,
        agentType: enriched.type,
        builderCode: enriched.builderCode,
        owner: enriched.owner,
        tokenURI: enriched.tokenUri,
        linkedWallet: enriched.wallet,
        reputation: {
          score: String(enriched.reputation.score),
          count: String(enriched.reputation.count),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ERC721') || msg.includes('owner') || msg.includes('nonexistent token')) {
        throw new IdentityNotFound(params.agentId)
      }
      throw new IdentityTxFailed(msg)
    }
  },

  async list(config: Config, params: ListParams): Promise<ListResult> {
    const client = getReadClient(config)
    const limit = params.limit ?? 20
    const fetchLimit = params.type ? limit * 3 : limit

    try {
      let result
      if (params.owner) {
        const ownerEvm = params.owner.startsWith('inj')
          ? (evm.injAddressToEth(params.owner) as `0x${string}`)
          : (params.owner as `0x${string}`)
        result = await client.getAgentsByOwner(ownerEvm, { limit: fetchLimit })
      } else {
        result = await client.listAgents({ limit: fetchLimit })
      }

      let agents: ListEntry[] = result.agents.map((a) => ({
        agentId: a.agentId.toString(),
        name: a.name,
        agentType: a.type,
        owner: a.owner,
      }))

      if (params.type) {
        agents = agents.filter((a) => a.agentType === params.type)
      }

      return { agents: agents.slice(0, limit), total: result.total }
    } catch (err) {
      throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
    }
  },

  async reputation(config: Config, params: ReputationParams): Promise<ReputationResult> {
    const client = getReadClient(config)
    const agentId = BigInt(params.agentId)

    try {
      const rep = await client.getReputation(agentId, {
        clientAddresses: params.clientAddresses as `0x${string}`[] | undefined,
        tag1: params.tag1,
        tag2: params.tag2,
      })
      return {
        agentId: params.agentId,
        score: rep.score,
        count: rep.count,
        clients: rep.clients,
      }
    } catch {
      return { agentId: params.agentId, score: 0, count: 0, clients: [] }
    }
  },

  async feedbackList(config: Config, params: FeedbackListParams): Promise<FeedbackListResult> {
    const client = getReadClient(config)
    const agentId = BigInt(params.agentId)

    try {
      const entries = await client.getFeedbackEntries(agentId, {
        clientAddresses: params.clientAddresses as `0x${string}`[] | undefined,
        tag1: params.tag1,
        tag2: params.tag2,
        includeRevoked: params.includeRevoked,
      })

      return {
        agentId: params.agentId,
        entries: entries.map((e) => ({
          client: e.client,
          feedbackIndex: Number(e.feedbackIndex),
          value: Number(e.value) / Math.pow(10, e.decimals),
          tag1: e.tags[0],
          tag2: e.tags[1],
          revoked: e.revoked,
        })),
      }
    } catch {
      return { agentId: params.agentId, entries: [] }
    }
  },
}
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Run existing read tests (expect some failures from changed mocks)**

```bash
npx vitest run src/identity/read.test.ts
```

Note which tests fail — they'll be updated in Task 14.

**Step 4: Commit**

```bash
git add src/identity/read.ts
git commit -m "refactor(identity): rewrite read.ts as thin adapter over @injective/agent-sdk"
```

---

### Task 12: Rewrite index.ts as thin adapter

**Files:**
- Rewrite: `src/identity/index.ts`

**Step 1: Write the write adapter**

```typescript
// src/identity/index.ts
import { AgentClient, PinataStorage } from '@injective/agent-sdk'
import type { AgentType } from '@injective/agent-sdk'
import type { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

// ── MCP Param/Result Types (preserved exactly) ──

export interface RegisterParams {
  address: string
  password: string
  name: string
  type: string
  builderCode: string
  wallet?: string
  uri?: string
  description?: string
  image?: string
  services?: { type: string; url: string; description?: string }[]
}

export interface RegisterResult {
  agentId: string
  txHash: string
  owner: string
  evmAddress: string
  cardUri: string
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

export interface UpdateParams {
  address: string
  password: string
  agentId: string
  name?: string
  type?: string
  builderCode?: string
  uri?: string
  wallet?: string
  description?: string
  image?: string
  services?: { type: string; url: string; description?: string }[]
  removeServices?: string[]
}

export interface UpdateResult {
  agentId: string
  txHashes: string[]
  cardUri?: string
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
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

export interface GiveFeedbackParams {
  address: string
  password: string
  agentId: string
  value: number
  valueDecimals?: number
  tag1?: string
  tag2?: string
  endpoint?: string
  feedbackURI?: string
  feedbackHash?: string
}

export interface GiveFeedbackResult {
  txHash: string
  agentId: string
  feedbackIndex?: string
}

export interface RevokeFeedbackParams {
  address: string
  password: string
  agentId: string
  feedbackIndex: number
}

export interface RevokeFeedbackResult {
  txHash: string
  agentId: string
}

// ── Helpers ──

function createClient(
  config: Config,
  address: string,
  password: string,
  storage?: InstanceType<typeof PinataStorage>,
): AgentClient {
  const hex = wallets.unlock(address, password)
  const privateKey = (hex.startsWith('0x') ? hex : `0x${hex}`) as `0x${string}`
  return new AgentClient({
    privateKey,
    network: config.network as 'testnet' | 'mainnet',
    storage,
    ipfsGateway: process.env['IPFS_GATEWAY'],
    audit: false,
  })
}

function getStorage(): PinataStorage | undefined {
  const jwt = process.env['PINATA_JWT']
  return jwt ? new PinataStorage({ jwt }) : undefined
}

function walletLinkInfo(
  requestedWallet: string | undefined,
  signerAddress: string,
  txHashes: string[],
): { walletTxHash?: string; walletLinkSkipped?: boolean; walletLinkReason?: string } {
  if (!requestedWallet) return {}
  if (requestedWallet.toLowerCase() !== signerAddress.toLowerCase()) {
    return {
      walletLinkSkipped: true,
      walletLinkReason: `Wallet ${requestedWallet} does not match signer ${signerAddress} — only self-links supported`,
    }
  }
  // If wallet matched, the second txHash is the wallet link
  return txHashes.length > 1 ? { walletTxHash: txHashes[1] } : {}
}

// ── Handlers ──

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    if (!params.uri && !process.env['PINATA_JWT']) {
      throw new IdentityTxFailed(
        'IPFS storage not configured. Set PINATA_JWT environment variable or provide a uri parameter.',
      )
    }

    try {
      const storage = getStorage()
      const client = createClient(config, params.address, params.password, storage)

      const result = await client.register({
        name: params.name,
        type: params.type as AgentType,
        builderCode: params.builderCode,
        wallet: (params.wallet ?? client.address) as `0x${string}`,
        description: params.description,
        image: params.image,
        services: params.services as RegisterParams['services'],
        uri: params.uri,
      })

      const txHashStrings = result.txHashes.map(String)
      return {
        agentId: result.agentId.toString(),
        txHash: txHashStrings[0] ?? '',
        owner: client.address,
        evmAddress: client.address,
        cardUri: result.cardUri,
        ...walletLinkInfo(params.wallet, client.address, txHashStrings),
      }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
    }
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    const needsCard = !!(params.description || params.image || params.services || params.removeServices)
    if (needsCard && !params.uri && !process.env['PINATA_JWT']) {
      throw new IdentityTxFailed(
        'IPFS storage not configured. Set PINATA_JWT environment variable or provide a uri parameter.',
      )
    }

    if (
      !params.name && !params.type && !params.builderCode &&
      !params.uri && !params.wallet && !needsCard
    ) {
      throw new IdentityTxFailed('At least one field to update must be provided.')
    }

    try {
      const storage = getStorage()
      const client = createClient(config, params.address, params.password, storage)
      const agentId = BigInt(params.agentId)

      const result = await client.update(agentId, {
        name: params.name,
        type: params.type as AgentType | undefined,
        builderCode: params.builderCode,
        wallet: params.wallet as `0x${string}` | undefined,
        uri: params.uri,
        description: params.description,
        image: params.image,
        services: params.services as UpdateParams['services'],
        removeServices: params.removeServices as any,
      })

      const txHashStrings = result.txHashes.map(String)
      return {
        agentId: params.agentId,
        txHashes: txHashStrings,
        cardUri: result.cardUri,
        ...walletLinkInfo(params.wallet, client.address, txHashStrings),
      }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
    }
  },

  async deregister(config: Config, params: DeregisterParams): Promise<DeregisterResult> {
    if (!params.confirm) throw new DeregisterNotConfirmed()

    try {
      const client = createClient(config, params.address, params.password)
      const result = await client.deregister(BigInt(params.agentId))
      return {
        agentId: params.agentId,
        txHash: result.txHash,
      }
    } catch (err) {
      if (err instanceof DeregisterNotConfirmed) throw err
      if (err instanceof IdentityTxFailed) throw err
      throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
    }
  },

  async giveFeedback(config: Config, params: GiveFeedbackParams): Promise<GiveFeedbackResult> {
    try {
      const client = createClient(config, params.address, params.password)
      const result = await client.giveFeedback({
        agentId: BigInt(params.agentId),
        value: BigInt(params.value),
        valueDecimals: params.valueDecimals,
        tag1: params.tag1,
        tag2: params.tag2,
        endpoint: params.endpoint,
        feedbackURI: params.feedbackURI,
        feedbackHash: params.feedbackHash as `0x${string}` | undefined,
      })
      return {
        txHash: result.txHash,
        agentId: params.agentId,
        feedbackIndex: result.feedbackIndex.toString(),
      }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
    }
  },

  async revokeFeedback(config: Config, params: RevokeFeedbackParams): Promise<RevokeFeedbackResult> {
    try {
      const client = createClient(config, params.address, params.password)
      const result = await client.revokeFeedback({
        agentId: BigInt(params.agentId),
        feedbackIndex: BigInt(params.feedbackIndex),
      })
      return {
        txHash: result.txHash,
        agentId: params.agentId,
      }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
    }
  },
}
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/identity/index.ts
git commit -m "refactor(identity): rewrite index.ts as thin adapter over @injective/agent-sdk"
```

---

### Task 13: Delete replaced files

**Files to delete:**
- `src/identity/abis.ts` (259 lines — replaced by SDK ABI exports)
- `src/identity/card.ts` (72 lines — replaced by SDK card utilities)
- `src/identity/storage.ts` (46 lines — replaced by SDK PinataStorage)
- `src/identity/types.ts` (42 lines — replaced by SDK type exports)
- `src/identity/helpers.ts` (63 lines — replaced by SDK contract utilities)
- `src/identity/client.ts` (46 lines — replaced by SDK's internal viem client creation)
- `src/identity/config.ts` (46 lines — replaced by SDK resolveNetworkConfig)

**Step 1: Delete implementation files**

```bash
cd /Users/dearkane/Documents/dev/inj/mcp-server
git rm src/identity/abis.ts src/identity/card.ts src/identity/storage.ts src/identity/types.ts src/identity/helpers.ts src/identity/client.ts src/identity/config.ts
```

**Step 2: Fix any remaining imports**

Check that `index.ts` and `read.ts` do NOT import from any deleted file. They should only import from `@injective/agent-sdk`, `../wallets/index.js`, `../config/index.js`, `../evm/index.js`, and `../errors/index.js`.

```bash
grep -n "from '\.\./\|from '\./" src/identity/index.ts src/identity/read.ts
```

Expected: only imports from `../wallets`, `../config`, `../evm`, `../errors`

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git commit -m "refactor(identity): delete 7 files replaced by @injective/agent-sdk imports

Removed: abis.ts, card.ts, storage.ts, types.ts, helpers.ts, client.ts, config.ts
Total: ~574 lines deleted"
```

---

### Task 14: Update test files

**Files:**
- Rewrite: `src/identity/identity.test.ts` (mock SDK instead of internals)
- Rewrite: `src/identity/read.test.ts` (mock SDK instead of internals)
- Delete: `src/identity/card.test.ts` (card logic now tested in SDK)
- Delete: `src/identity/storage.test.ts` (storage logic now tested in SDK)
- Delete: `src/identity/helpers.test.ts` (helpers now tested in SDK)
- Delete: `src/identity/config.test.ts` (config now tested in SDK)
- Delete: `src/identity/client.test.ts` (client creation now in SDK)

**Step 1: Delete obsolete test files**

```bash
git rm src/identity/card.test.ts src/identity/storage.test.ts src/identity/helpers.test.ts src/identity/config.test.ts src/identity/client.test.ts
```

**Step 2: Rewrite identity.test.ts**

The new tests mock `@injective/agent-sdk` at the module level:

```typescript
// src/identity/identity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config } from '../config/index.js'

// Mock the SDK
const mockRegister = vi.fn()
const mockUpdate = vi.fn()
const mockDeregister = vi.fn()
const mockGiveFeedback = vi.fn()
const mockRevokeFeedback = vi.fn()

vi.mock('@injective/agent-sdk', () => ({
  AgentClient: vi.fn().mockImplementation(() => ({
    address: '0xabc123' + '0'.repeat(34),
    register: mockRegister,
    update: mockUpdate,
    deregister: mockDeregister,
    giveFeedback: mockGiveFeedback,
    revokeFeedback: mockRevokeFeedback,
  })),
  PinataStorage: vi.fn(),
}))

vi.mock('../wallets/index.js', () => ({
  wallets: { unlock: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)) },
}))

function testConfig(): Config {
  return { network: 'testnet', /* ... other config fields ... */ } as Config
}

describe('identity.register', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should delegate to AgentClient.register and format result', async () => {
    mockRegister.mockResolvedValue({
      agentId: 42n,
      cardUri: 'ipfs://abc',
      txHashes: ['0x1111' + '0'.repeat(60)],
      identityTuple: 'eip155:1439:0x19d1:42',
      scanUrl: 'https://8004scan.io/agent/42',
    })

    const { identity } = await import('./index.js')
    const result = await identity.register(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test',
      name: 'Test Agent',
      type: 'trading',
      builderCode: 'test-builder',
    })

    expect(result.agentId).toBe('42')
    expect(result.txHash).toMatch(/^0x/)
    expect(result.cardUri).toBe('ipfs://abc')
  })

  it('should throw IdentityTxFailed when no PINATA_JWT and no uri', async () => {
    delete process.env['PINATA_JWT']
    const { identity } = await import('./index.js')
    await expect(
      identity.register(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test',
        name: 'Test', type: 'trading', builderCode: 'bc',
      }),
    ).rejects.toThrow('IPFS storage not configured')
  })
})

describe('identity.deregister', () => {
  it('should throw DeregisterNotConfirmed when confirm is false', async () => {
    const { identity } = await import('./index.js')
    await expect(
      identity.deregister(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test',
        agentId: '42',
        confirm: false,
      }),
    ).rejects.toThrow('confirm')
  })
})

// ... similar patterns for update, giveFeedback, revokeFeedback
```

**Step 3: Rewrite read.test.ts**

Similar pattern — mock `@injective/agent-sdk`:

```typescript
// src/identity/read.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  })),
}))

describe('identityRead.status', () => {
  it('should map SDK EnrichedAgentResult to MCP StatusResult', async () => {
    mockGetEnrichedAgent.mockResolvedValue({
      agentId: 42n, name: 'Test', type: 'trading', builderCode: 'bc',
      owner: '0xabc', tokenUri: 'ipfs://xyz', wallet: '0xdef',
      identityTuple: 'eip155:1439:0x19d1:42',
      reputation: { score: 4.5, count: 10, clients: ['0x111'] },
    })

    const { identityRead } = await import('./read.js')
    const result = await identityRead.status(testConfig(), { agentId: '42' })

    expect(result.agentId).toBe('42')
    expect(result.agentType).toBe('trading')  // field rename
    expect(result.linkedWallet).toBe('0xdef')  // field rename
    expect(result.tokenURI).toBe('ipfs://xyz')  // case change
    expect(result.reputation.score).toBe('4.5')  // number → string
    expect(result.reputation.count).toBe('10')   // number → string
  })
})

// ... similar for list, reputation, feedbackList
```

**Step 4: Run all tests**

```bash
npx vitest run src/identity/
```

Expected: all tests pass

**Step 5: Commit**

```bash
git add -A src/identity/
git commit -m "test(identity): update tests to mock SDK adapter layer

Deleted: card.test.ts, storage.test.ts, helpers.test.ts, config.test.ts, client.test.ts
Rewrote: identity.test.ts, read.test.ts (now mock @injective/agent-sdk)"
```

---

### Task 15: Final verification and cleanup

**Step 1: Full build**

```bash
npm run build
```

**Step 2: Full test suite**

```bash
npm test
```

**Step 3: Check for dead imports**

```bash
grep -rn "from.*identity/abis\|from.*identity/card\|from.*identity/storage\|from.*identity/types\|from.*identity/helpers\|from.*identity/client\|from.*identity/config" src/
```

Expected: no matches

**Step 4: Verify line count reduction**

```bash
wc -l src/identity/index.ts src/identity/read.ts
```

Expected: ~200 total lines (down from ~840)

**Step 5: Check server.ts has zero changes**

```bash
git diff HEAD -- src/mcp/server.ts
```

Expected: empty (no changes)

**Step 6: Commit**

```bash
git commit --allow-empty -m "chore(identity): verify convergence onto @injective/agent-sdk complete

src/identity/ reduced from 9 impl files (~750 lines) to 2 adapter files (~200 lines).
7 files deleted, 2 rewritten. server.ts unchanged."
```

---

## Dependency Graph

```
Task 1 (SDK entry point)
  └→ Task 2 (storage) ─→ Task 3 (config + errors)
       └→ Task 4 (AgentClient) ─→ Task 5 (update method)
            └→ Task 6 (AgentReadClient)
                 └→ Task 7 (CLI refactor)
                      └→ Task 8 (SDK tests) ─→ Task 9 (tag release)
                           └→ Task 10 (add dep to MCP)
                                ├→ Task 11 (read adapter)
                                └→ Task 12 (write adapter)
                                     └→ Task 13 (delete files)
                                          └→ Task 14 (update tests)
                                               └→ Task 15 (verification)
```

Tasks 11 and 12 can run in parallel after Task 10.

## Open Items for During Implementation

- **GAP-01 (ipfsGateway):** Task 3 adds `ipfsGateway` to `ResolveConfigOptions`. Verify the SDK's `AgentClient` passes it through to `fetchAgentCard` during `update()`. If not, add a one-line override in `agent-client.ts` constructor.
- **GAP-02 (AgentType widening):** The MCP adapter casts `params.type as AgentType`. If the SDK validates strictly and rejects unknown types, widen `AgentType` to `string` or add an `| string` union in the SDK types.
- **UpdateResult.cardUri:** Task 5 adds `cardUri` to the SDK's `UpdateResult`. If for some reason this can't be returned (e.g., the card URI is only known before upload), the MCP adapter can read `tokenURI` from chain after update as a fallback.
- **SDK dependency format:** Task 10 uses `file:` for local dev. Before merging, decide on git dependency vs npm publish. Pin to exact version/tag.
