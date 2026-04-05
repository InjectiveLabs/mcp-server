# Identity Integration Tests

Full end-to-end tests against **Injective testnet contracts** and **IPFS**.

## What It Tests

The integration test suite validates the complete agent identity lifecycle:

1. **Register** — Create a new agent with full metadata on testnet
   - Name, type, builder code
   - Description, random image URL
   - Multiple services (trading, analytics)
   - Metadata stored on IPFS via Pinata

2. **Status** — Fetch the registered agent's on-chain details
   - Metadata retrieval from IPFS
   - Owner verification
   - Reputation score/count

3. **List** — List all agents by owner
   - Pagination
   - Agent count verification

4. **Give Feedback** — Submit feedback on the agent
   - Feedback value encoding
   - Tags and metadata
   - Real blockchain transaction

5. **Reputation** — Fetch updated reputation after feedback
   - Score/count aggregation
   - Client address filtering
   - Decimal normalization

6. **Feedback List** — Retrieve all feedback entries
   - Filtering by client
   - Tag parsing
   - Revocation status

## Requirements

### Environment Variables

Set these before running tests:

```bash
export TEST_ADDRESS="inj1..."          # Your testnet address
export TEST_PASSWORD="..."             # Keystore password
export PINATA_JWT="..."                # Pinata API token
```

### Testnet Setup

1. **Wallet** — Must exist in the local keystore
   ```bash
   # Create one if needed:
   npx tsx src/wallets/cli.ts generate
   npx tsx src/wallets/cli.ts list
   ```

2. **Testnet INJ** — Need gas fees for transactions
   - Get testnet INJ from faucet: https://testnet.injective.dev/
   - ~0.1 INJ per test run

3. **Pinata Account** — For IPFS storage
   - Create account at https://app.pinata.cloud/
   - Generate JWT token

## Running Tests

### Run All Integration Tests

```bash
export TEST_ADDRESS="inj1..." TEST_PASSWORD="..." PINATA_JWT="..."
npm test -- src/identity/integration.test.ts
```

### Run Without Env Vars (Skipped)

```bash
npm test -- src/identity/integration.test.ts
# Output: "6 skipped (6)" — tests are conditionally skipped
```

### Run Specific Test

```bash
export TEST_ADDRESS="inj1..." TEST_PASSWORD="..." PINATA_JWT="..."
npm test -- src/identity/integration.test.ts -t "registers agent"
```

### Increase Timeout

Tests have 2-min timeout for registration (blockchain is slow). If needed:

```bash
npm test -- src/identity/integration.test.ts --bail 1 --reporter=verbose
```

## Expected Output

```
🔐 Verifying wallet at inj1...
✅ Wallet unlocked successfully

📝 Registering agent on testnet...
✅ Agent registered!
   • Agent ID: 42
   • TX Hash: 0x...
   • Card URI: ipfs://Qm...
   • Owner: 0x...

📊 Fetching agent status from testnet...
✅ Status fetched!
   • Name: E2E Test Agent ...
   • Type: trading
   • Reputation: 0/0

📋 Listing agents by owner...
✅ Found 1 agents

⭐ Giving feedback on agent...
✅ Feedback given!
   • TX Hash: 0x...
   • Feedback Index: 0

📈 Fetching updated reputation...
✅ Reputation updated!
   • Score: 85
   • Count: 1

📝 Listing feedback entries...
✅ Found 1 feedback entries

✓ src/identity/integration.test.ts (6 tests)
```

## Troubleshooting

### "TEST_ADDRESS not set"
```bash
export TEST_ADDRESS="inj1..." && npm test -- src/identity/integration.test.ts
```

### "Wallet not found"
Check keystore has the address:
```bash
npx tsx src/wallets/cli.ts list
```

### "Wrong password" or unlock fails
Verify password is correct. Wallets are encrypted in `~/.inj-agent/keystore/`.

### "IPFS storage not configured"
Need PINATA_JWT:
```bash
export PINATA_JWT="..." && npm test -- src/identity/integration.test.ts
```

### "Insufficient funds" or gas error
Get more testnet INJ from faucet:
https://testnet.injective.dev/

### "Contract reverted" or permission errors
- Address may not be authorized on testnet contracts
- Check testnet AgentIdentity contract deployment
- Verify address is in the registry

### Timeout (> 120s)
- Testnet may be slow
- Increase timeout in test file
- Check network connectivity

## Test Independence

Tests run sequentially and each depends on the previous:

1. Register → creates agent
2. Status → fetches that agent
3. List → verifies agent in list
4. Feedback → gives feedback on agent
5. Reputation → checks feedback updated score
6. Feedback List → verifies feedback persisted

If registration fails, all subsequent tests fail.

## Cost Estimate

- **Register**: ~0.05 INJ (metadata + IPFS)
- **Give Feedback**: ~0.01 INJ
- **Reads**: Free
- **Total per run**: ~0.06 INJ (~$0.03 at current rates)

## Notes

- Each test run creates a new agent with `Date.now()` in the name
- Tests don't clean up — agents remain on testnet
- Safe to run multiple times with same credentials
- Uses same SDK code as production (no mocks)
