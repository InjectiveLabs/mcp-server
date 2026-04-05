# Known Issues

## SDK: Wallet Linking Deadline Too Far

**Status**: Blocked on SDK fix  
**Component**: `@injective/agent-sdk` setAgentWallet  
**Symptom**: `Identity transaction failed: Simulation failed for setAgentWallet: The contract function "setAgentWallet" reverted with the following reason: deadline too far`  
**Trigger**: Registering an agent with wallet parameter or without explicit wallet (defaults to signer address)

### Root Cause

The `AgentClient.register()` method unconditionally calls `setAgentWallet` (line 166 in `src/identity/index.ts`):

```typescript
wallet: (params.wallet ?? client.address) as `0x${string}`,  // Always sets wallet
```

The SDK's wallet linking implementation (`setAgentWallet`) calculates a transaction deadline that is either:
- In the past (already expired), or  
- Too far in the future (contract rejects it)

### Impact

- Cannot register agents with wallet linking on testnet
- Affects: `identity.register()` with `wallet` param, or default behavior
- Does NOT affect: Registration without wallet param (if SDK behavior changes), read operations, feedback operations

### Workaround

None currently. Requires SDK fix.

### What We Tested

Full E2E test suite (`scripts/e2e-quick-test.ts`):
- ✅ Register endpoint reached, metadata prepared, IPFS upload works
- ❌ Blockchain transaction simulation fails at wallet linking step
- ✅ Other operations (status, feedback, reputation) are unaffected by this bug

### SDK PR Needed

Fix the deadline calculation in `@injective/agent-sdk`'s `setAgentWallet` implementation to use a reasonable timeout (typically 60-120 seconds from now) instead of invalid values.

### Adapter Status

The adapter code (`src/identity/index.ts`) correctly passes all parameters to the SDK. The bug is entirely in the SDK implementation.
