# Injective MCP Server

An MCP (Model Context Protocol) server that lets AI agents trade perpetual futures on [Injective](https://injective.com).

## What It Does

Exposes Injective perpetual futures trading as MCP tools for Claude Desktop / Claude Code:

| Tool | Description |
|---|---|
| `wallet_generate` | Generate a new encrypted wallet |
| `wallet_import` | Import a wallet from a private key |
| `wallet_list` | List all local wallets |
| `wallet_remove` | Remove a wallet from the keystore |
| `market_list` | List all active perpetual markets |
| `market_price` | Get oracle price for a market |
| `account_balances` | Get bank + subaccount balances |
| `account_positions` | Get open positions with P&L |
| `trade_open` | Open a perpetual position (market order) |
| `trade_close` | Close an open position (market order) |

## Architecture

```
Claude (MCP client)
    │  tool calls
    ▼
MCP Server (src/mcp/server.ts)
    │
    ▼
Core Library
├── config/     Network configuration (testnet/mainnet)
├── keystore/   AES-256-GCM encrypted key storage
├── wallets/    Wallet generation and management
├── markets/    Market data with caching
├── accounts/   Balances and positions
└── trading/    Open/close perpetual positions
    │
    ▼
Injective Chain (via @injectivelabs/sdk-ts)
```

## Setup

```bash
npm install
npm run build
```

### Connect to Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "injective": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/mcp/server.js"],
      "env": {
        "INJECTIVE_NETWORK": "testnet"
      }
    }
  }
}
```

Set `INJECTIVE_NETWORK` to `"mainnet"` for production.

### Connect to Claude Code

Add to your project's MCP config or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "injective": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/mcp/server.js"],
      "env": { "INJECTIVE_NETWORK": "testnet" }
    }
  }
}
```

## Usage Example

Once connected, Claude can:

1. **Generate a wallet** — `wallet_generate` (save the mnemonic!)
2. **Fund it** — send USDT to the address via the [testnet faucet](https://testnet.faucet.injective.network/)
3. **Check balances** — `account_balances`
4. **List markets** — `market_list`
5. **Open a position** — `trade_open` with symbol, side, amount, leverage
6. **Monitor** — `account_positions` to see P&L
7. **Close** — `trade_close`

## Security

- Private keys are encrypted at rest with AES-256-GCM + scrypt
- Claude never sees private keys — only addresses and tx hashes
- Wallet passwords flow through MCP tool parameters (may appear in logs — see `SECURITY.md`)
- Keystore location: `~/.injective-agent/keys/`

See [SECURITY.md](./SECURITY.md) for the full security model.

## Development

```bash
npm test              # unit tests (no network)
npm run test:integration  # integration tests against testnet
npm run typecheck     # type check only
```

## Dependencies

| Package | Purpose |
|---|---|
| `@injectivelabs/sdk-ts` | Chain interaction, signing, message building |
| `@injectivelabs/networks` | Endpoint resolution |
| `@injectivelabs/utils` | BigNumber utilities |
| `decimal.js` | Arbitrary-precision financial math |
| `@modelcontextprotocol/sdk` | MCP server framework |

## Network Support

| Network | Value |
|---|---|
| Testnet | `INJECTIVE_NETWORK=testnet` |
| Mainnet | `INJECTIVE_NETWORK=mainnet` |
