# Security Model

## What the AI agent sees

- Wallet addresses (`inj1...`)
- Transaction hashes
- Market data (prices, tickers)
- Balances and positions

## What the AI agent NEVER sees

- Private keys
- Raw key material
- Mnemonics (after initial generation display)

## Key storage

Private keys are encrypted at rest using AES-256-GCM with scrypt key derivation:
- Random 32-byte salt per key file
- Random 12-byte IV per key file
- Directory: `~/.injective-agent/keys/`
- File permissions: `0o600` (owner read/write only)

## Known trade-off: password exposure

Passwords are passed as function parameters and flow through MCP tool calls.
If the MCP client logs tool invocations, passwords may appear in those logs.

**Mitigation**: Check your MCP client's logging configuration. Do not use high-value
wallet passwords that are reused elsewhere.

## Operational security

- Use testnet for development and testing
- Fund mainnet wallets with only as much as you're willing to lose
- The library uses market orders — slippage is real, losses can exceed margin
- Liquidation prices are estimates — actual liquidation depends on mark price oracles
