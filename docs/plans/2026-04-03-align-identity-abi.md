# Align Identity Module with Real Contract ABI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the assumed ERC-8004 ABI with the real `IdentityRegistryUpgradeable` ABI and rewrite all handlers to match the deployed contract on Injective EVM testnet.

**Architecture:** Replace `abis.ts` with real function signatures, add `helpers.ts` for metadata encode/decode and EIP-712 wallet-link signing, rewrite register (bare mint + optional wallet link), update (per-key setMetadata), and read (per-key getMetadata + getAgentWallet). The `withIdentityTx` helper pattern and client caching from the prior implementation are preserved.

**Tech Stack:** viem 2.x (writeContract, readContract, encodeAbiParameters, signTypedData), vitest, zod 3.x

**PRD:** PRD-ecosystem-growth-2026-023

---

## Current Codebase State

```
src/identity/
  abis.ts          ← WRONG: assumed ABI, must be replaced
  config.ts        ← OK: real testnet addresses already set
  client.ts        ← OK: cached viem client factory
  index.ts         ← WRONG: register/update/deregister use wrong functions
  read.ts          ← WRONG: getMetadata signature wrong, getLinkedWallet renamed
  identity.test.ts ← must update mocks
  read.test.ts     ← must update mocks
  config.test.ts   ← OK
  client.test.ts   ← OK
```

Key existing patterns to preserve:
- `withIdentityTx(config, address, password, fn)` — DRY helper for write ops
- `createIdentityPublicClient(network)` — cached per network
- `IdentityTxFailed` / `DeregisterNotConfirmed` error classes
- `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }` response format

---

## Task 1: Create `identity/helpers.ts` with Encode/Decode/Sign Utilities

**Files:**
- Create: `src/identity/helpers.ts`
- Test: `src/identity/helpers.test.ts`

**Step 1: Write failing tests**

```typescript
// src/identity/helpers.test.ts
import { describe, it, expect } from 'vitest'
import { encodeStringMetadata, decodeStringMetadata, walletLinkDeadline } from './helpers.js'

describe('encodeStringMetadata', () => {
  it('encodes a string to ABI bytes', () => {
    const encoded = encodeStringMetadata('trading')
    expect(encoded).toMatch(/^0x/)
    expect(encoded.length).toBeGreaterThan(2)
  })

  it('round-trips with decodeStringMetadata', () => {
    const original = 'my-builder-code-123'
    const encoded = encodeStringMetadata(original)
    const decoded = decodeStringMetadata(encoded)
    expect(decoded).toBe(original)
  })

  it('handles empty string', () => {
    const encoded = encodeStringMetadata('')
    const decoded = decodeStringMetadata(encoded)
    expect(decoded).toBe('')
  })
})

describe('decodeStringMetadata', () => {
  it('returns empty string for 0x', () => {
    expect(decodeStringMetadata('0x')).toBe('')
  })
})

describe('walletLinkDeadline', () => {
  it('returns a bigint in the future', () => {
    const deadline = walletLinkDeadline()
    const now = BigInt(Math.floor(Date.now() / 1000))
    expect(deadline).toBeGreaterThan(now)
    expect(deadline).toBeLessThanOrEqual(now + 700n) // ~10 min + buffer
  })

  it('accepts custom offset', () => {
    const deadline = walletLinkDeadline(120)
    const now = BigInt(Math.floor(Date.now() / 1000))
    expect(deadline).toBeLessThanOrEqual(now + 130n)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/identity/helpers.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/identity/helpers.ts
import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from 'viem'
import type { Account, Chain, Hex } from 'viem'

const STRING_PARAM = parseAbiParameters('string')

export function encodeStringMetadata(value: string): Hex {
  return encodeAbiParameters(STRING_PARAM, [value])
}

export function decodeStringMetadata(raw: Hex): string {
  if (!raw || raw === '0x') return ''
  const [decoded] = decodeAbiParameters(STRING_PARAM, raw)
  return decoded
}

export function walletLinkDeadline(offsetSeconds = 600): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds)
}

export interface SignWalletLinkParams {
  account: Account
  agentId: bigint
  newWallet: `0x${string}`
  ownerAddress: `0x${string}`
  deadline: bigint
  chainId: number
  verifyingContract: `0x${string}`
}

export async function signWalletLink(params: SignWalletLinkParams): Promise<Hex> {
  if (!params.account.signTypedData) {
    throw new Error('Account does not support signTypedData')
  }
  return params.account.signTypedData({
    domain: {
      name: 'ERC8004IdentityRegistry',
      version: '1',
      chainId: params.chainId,
      verifyingContract: params.verifyingContract,
    },
    types: {
      AgentWalletSet: [
        { name: 'agentId', type: 'uint256' },
        { name: 'newWallet', type: 'address' },
        { name: 'owner', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'AgentWalletSet',
    message: {
      agentId: params.agentId,
      newWallet: params.newWallet,
      owner: params.ownerAddress,
      deadline: params.deadline,
    },
  })
}
```

**Step 4: Run tests**

Run: `npx vitest run src/identity/helpers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/identity/helpers.ts src/identity/helpers.test.ts
git commit -m "feat(identity): add metadata encode/decode and EIP-712 wallet-link helpers"
```

---

## Task 2: Replace `abis.ts` with Real Contract ABI

**Files:**
- Modify: `src/identity/abis.ts` (complete rewrite)

**Step 1: Rewrite abis.ts**

```typescript
// src/identity/abis.ts
//
// ABI subset for the deployed IdentityRegistryUpgradeable contract.
// Source: verified against live testnet contract at 0x19d1916b...
// Only includes functions called by the identity module.

export const IDENTITY_REGISTRY_ABI = [
  // ── Registration ──
  {
    type: 'function',
    name: 'register',
    inputs: [],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'agentURI', type: 'string' },
      {
        name: 'metadataEntries',
        type: 'tuple[]',
        components: [
          { name: 'metadataKey', type: 'string' },
          { name: 'metadataValue', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  // ── Metadata ──
  {
    type: 'function',
    name: 'setMetadata',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
      { name: 'metadataValue', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── URI ──
  {
    type: 'function',
    name: 'setAgentURI',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newURI', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Wallet linking ──
  {
    type: 'function',
    name: 'setAgentWallet',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Deregister ──
  {
    type: 'function',
    name: 'deregister',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Read: metadata ──
  {
    type: 'function',
    name: 'getMetadata',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  // ── Read: wallet ──
  {
    type: 'function',
    name: 'getAgentWallet',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  // ── Read: reverse lookup ──
  {
    type: 'function',
    name: 'getAgentByWallet',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // ── Read: standard ERC-721 ──
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  // ── Events ──
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

// ReputationRegistry ABI — unchanged from prior implementation
export const REPUTATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getReputation',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'score', type: 'uint256' },
      { name: 'feedbackCount', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors (tests will break until handlers are updated — that's expected).

**Step 3: Commit**

```bash
git add src/identity/abis.ts
git commit -m "fix(identity): replace assumed ABI with real IdentityRegistryUpgradeable ABI"
```

---

## Task 3: Rewrite Write Handlers (register, update, deregister)

**Files:**
- Modify: `src/identity/index.ts` (major rewrite)
- Modify: `src/identity/identity.test.ts` (update all mocks)

This is the largest task. The key changes:
- `register`: calls `register(agentURI, MetadataEntry[])` overload, extracts agentId from `Registered` event, optionally calls `setAgentWallet` with EIP-712 sig
- `update`: calls `setMetadata(id, key, encodedValue)` per changed key, `setAgentURI` for URI, `setAgentWallet` for wallet
- `deregister`: unchanged (already correct)

**Interfaces change:**
- `RegisterParams.type` → `string` (e.g. "trading") instead of `number`
- `RegisterParams.builderCode` → plain `string` (not bytes32 hex)
- `RegisterResult` adds `walletTxHash?` and `walletLinkSkipped?` and `walletLinkReason?`
- `UpdateParams.type` → `string` (same as register)
- `UpdateParams.builderCode` → plain `string`
- `UpdateParams` adds optional `name` field
- `UpdateResult` adds `walletTxHash?` / `walletLinkSkipped?` / `walletLinkReason?`

**The `withIdentityTx` helper stays** — same unlock/client/catch pattern. The `TxContext` gains `identityCfg` (the full config, needed for chainId in EIP-712).

**Step 1: Write updated tests**

Rewrite `src/identity/identity.test.ts` with mocks matching the new ABI. Key changes to mock expectations:
- `register` mock: expects `functionName: 'register'`, args include tuple array for metadata
- `register` receipt: mock the `Registered` event (different topic structure from Transfer)
- `update` mock: expects `functionName: 'setMetadata'` for metadata, `'setAgentURI'` for URI, `'setAgentWallet'` for wallet
- `deregister`: mock stays same

Tests needed:
1. **register**: registers with metadata + URI, returns agentId from Registered event
2. **register with self-wallet-link**: after register, calls setAgentWallet with EIP-712 sig
3. **register with different wallet**: registers, skips wallet link, returns warning
4. **register without wallet param**: registers, no wallet link attempt
5. **update name**: calls setMetadata(id, "name", encoded)
6. **update builderCode**: calls setMetadata(id, "builderCode", encoded)
7. **update URI**: calls setAgentURI(id, newURI)
8. **update multiple fields**: multiple txs, one per change
9. **update no fields**: throws before unlock
10. **deregister confirm=true**: unchanged
11. **deregister confirm=false**: unchanged
12. **error wrapping**: unchanged

**Step 2: Write updated implementation**

Rewrite `src/identity/index.ts`:
- Import helpers: `encodeStringMetadata`, `walletLinkDeadline`, `signWalletLink`
- Import `getIdentityConfig` for chainId (needed for EIP-712 domain)
- Update `RegisterParams`: `type: string`, `builderCode: string`, `wallet?: string`
- Update `RegisterResult`: add optional wallet fields
- `register` handler: build MetadataEntry[], call register overload, parse Registered event, optionally sign and link wallet
- `update` handler: per-key setMetadata, setAgentURI, setAgentWallet with EIP-712
- `deregister`: no changes to logic

**Step 3: Run tests**

Run: `npx vitest run src/identity/identity.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/identity/index.ts src/identity/identity.test.ts
git commit -m "fix(identity): rewrite register/update handlers for real contract ABI

- register() now calls register(agentURI, MetadataEntry[]) overload
- Extracts agentId from Registered event instead of Transfer
- Wallet linking uses EIP-712 signature (self-link only)
- update() uses per-key setMetadata instead of tuple updateMetadata
- URI updates use setAgentURI instead of setTokenURI"
```

---

## Task 4: Rewrite Read Handlers (status, list)

**Files:**
- Modify: `src/identity/read.ts`
- Modify: `src/identity/read.test.ts`

Key changes:
- `status()`: replace single `getMetadata(id)` → parallel per-key calls `getMetadata(id, "builderCode")`, `getMetadata(id, "agentType")`, decode bytes with `decodeStringMetadata`
- `status()`: rename `getLinkedWallet` → `getAgentWallet`
- `list()`: per-agent detail fetches use corrected function names. The Transfer event scanning is unchanged.
- `StatusResult.name`: read from tokenURI JSON or from metadata key "name" as fallback

**Step 1: Write updated tests**

Update `src/identity/read.test.ts`:
- `status` mock: `readContract` calls now match `getMetadata(id, "builderCode")`, `getMetadata(id, "agentType")`, `getAgentWallet(id)`, etc.
- Mock returns raw bytes (from `encodeStringMetadata`) for metadata calls
- `list` mock: `getMetadata` → `ownerOf` only (list doesn't fetch per-key metadata)

**Step 2: Write updated implementation**

Update `src/identity/read.ts`:
- Import `decodeStringMetadata` from helpers
- `status()`: fetch builderCode + agentType as per-key metadata, decode bytes
- Rename getLinkedWallet → getAgentWallet
- `list()`: minimal change — just ensure per-agent fetches use correct function names

**Step 3: Run tests**

Run: `npx vitest run src/identity/read.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/identity/read.ts src/identity/read.test.ts
git commit -m "fix(identity): rewrite read handlers for per-key metadata and getAgentWallet"
```

---

## Task 5: Update Tool Schemas in server.ts

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/server.test.ts`

Key changes:
- `agent_register.builderCode`: change from bytes32 hex regex to plain `z.string().min(1)`
- `agent_register.type`: change from `z.number().int().min(0).max(255)` to `z.string().min(1)` (e.g., "trading", "analytics")
- `agent_register` description: add note about wallet self-link constraint
- `agent_update.builderCode`: same change as register
- `agent_update.type`: same change as register
- `agent_update`: add optional `name` field
- Update schema tests to match

**Step 1: Update server.ts schemas**

For `agent_register`:
```typescript
name: z.string().min(1).describe('Human-readable agent name.'),
type: z.string().min(1).describe('Agent type (e.g., "trading", "analytics", "data").'),
builderCode: z.string().min(1).describe('Builder identifier string.'),
wallet: ethAddress.optional().describe('EVM wallet to link. Only works if it matches the keystore address (same key). Omit to skip wallet linking.'),
```

For `agent_update`:
```typescript
name: z.string().min(1).optional().describe('New agent name.'),
type: z.string().min(1).optional().describe('New agent type.'),
builderCode: z.string().min(1).optional().describe('New builder identifier.'),
```

**Step 2: Update schema tests**

Remove the bytes32 regex tests for builderCode (it's now a plain string). Update type field tests (string instead of number).

**Step 3: Run tests**

Run: `npm test`
Expected: ALL tests pass

**Step 4: Commit**

```bash
git add src/mcp/server.ts src/mcp/server.test.ts
git commit -m "fix(identity): update tool schemas for string-based builderCode and type"
```

---

## Task 6: Full Verification + Integration Test

**Files:**
- Modify: `src/integration/identity.integration.test.ts` (update for new ABI)

**Step 1: Update integration test**

The integration test needs to:
- Call `identity.register()` with string type/builderCode and a URI
- Verify agentId extracted from Registered event
- Call `identityRead.status()` and verify per-key metadata decoding
- Call `identity.update()` with a name change (per-key setMetadata)
- Call `identityRead.list()` and verify the agent appears
- Call `identity.deregister()` to cleanup

**Step 2: Run full verification**

1. `npx tsc --noEmit` — clean
2. `npm test` — all unit tests pass
3. `npm run build` — clean build
4. `grep -c "server.tool(" src/mcp/server.ts` — still 33

**Step 3: Commit**

```bash
git add src/integration/identity.integration.test.ts
git commit -m "fix(identity): update integration test for real contract ABI"
```

---

## Task 7: Cleanup Probe Scripts

**Files:**
- Delete: `scripts/probe-contract.ts`
- Delete: `scripts/extract-selectors.ts`
- Delete: `scripts/find-abi.ts`
- Delete: `scripts/check-balance.ts`
- Delete: `scripts/try-register.ts`
- Keep: `scripts/register-test-agent.ts` (update to use new handlers)

**Step 1: Remove probe scripts, update demo script**

**Step 2: Commit**

```bash
git rm scripts/probe-contract.ts scripts/extract-selectors.ts scripts/find-abi.ts scripts/check-balance.ts scripts/try-register.ts
git add scripts/register-test-agent.ts
git commit -m "chore: remove ABI probe scripts, update demo script"
```

---

## Summary

| Task | What | Files | Key Changes |
|------|------|-------|-------------|
| 1 | Helpers | `helpers.ts` + test | encode/decode metadata, EIP-712 sign, deadline |
| 2 | ABI | `abis.ts` | Complete rewrite to real contract interface |
| 3 | Write handlers | `index.ts` + test | register(uri, metadata[]), per-key setMetadata, EIP-712 wallet |
| 4 | Read handlers | `read.ts` + test | per-key getMetadata, getAgentWallet rename |
| 5 | Tool schemas | `server.ts` + test | builderCode/type → string, wallet note |
| 6 | Verification | integration test | Full lifecycle against testnet |
| 7 | Cleanup | scripts/ | Remove probe scripts |

**Total rewrites:** 4 files (`abis.ts`, `index.ts`, `read.ts`, tests)
**New file:** 1 (`helpers.ts`)
**Estimated commits:** 7
