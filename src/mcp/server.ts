#!/usr/bin/env node
/**
 * MCP Server — exposes Injective trading capabilities as tools for Claude.
 *
 * Security rules enforced here:
 * - The LLM never sees private keys, only addresses and tx hashes.
 * - Every trade tool requires explicit confirmation (addressed in tool descriptions).
 * - Passwords flow through tool params — document this in the server instructions.
 *
 * WARNING: MCP tool calls may be logged by the client. Passwords passed to
 * trade tools could appear in logs. Advise users accordingly.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createConfig } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { markets } from '../markets/index.js'
import { accounts } from '../accounts/index.js'
import { trading } from '../trading/index.js'

const server = new McpServer({
  name: 'injective-agent',
  version: '0.1.0',
})

// ─── Config ─────────────────────────────────────────────────────────────────

const NETWORK = (process.env['INJECTIVE_NETWORK'] ?? 'testnet') as 'mainnet' | 'testnet'
const config = createConfig(NETWORK)

// ─── Wallet Tools ────────────────────────────────────────────────────────────

server.tool(
  'wallet_generate',
  'Generate a new Injective wallet. Returns the address and the mnemonic phrase. ' +
  'IMPORTANT: The mnemonic is shown only once — the user must write it down immediately.',
  {
    password: z.string().min(8).describe('Encryption password for the keystore. Never share this.'),
    name: z.string().optional().describe('Optional human-readable label for this wallet.'),
  },
  async ({ password, name }) => {
    const result = wallets.generate(password, name)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          address: result.address,
          mnemonic: result.mnemonic,
          warning: 'Write down this mnemonic NOW. It will never be shown again.',
        }, null, 2),
      }],
    }
  },
)

server.tool(
  'wallet_import',
  'Import an existing Injective wallet from a hex private key. Returns the address. ' +
  'WARNING: The private key is passed as a tool parameter and may appear in MCP client logs ' +
  'and conversation history. Only use this on trusted, local MCP setups.',
  {
    privateKeyHex: z.string().describe('The 0x-prefixed hex private key to import.'),
    password: z.string().min(8).describe('Encryption password for the keystore.'),
    name: z.string().optional().describe('Optional label for this wallet.'),
  },
  async ({ privateKeyHex, password, name }) => {
    const result = wallets.import(privateKeyHex, password, name)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          address: result.address,
          warning: 'The private key you passed may be stored in conversation logs. ' +
            'Consider rotating to a new wallet if this session is not fully trusted.',
        }, null, 2),
      }],
    }
  },
)

server.tool(
  'wallet_list',
  'List all wallets stored in the local keystore. Returns addresses and labels only — no keys.',
  {},
  async () => {
    const list = wallets.list()
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(list, null, 2),
      }],
    }
  },
)

server.tool(
  'wallet_remove',
  'Remove a wallet from the local keystore. This deletes the encrypted key file permanently.',
  {
    address: z.string().describe('The inj1... address of the wallet to remove.'),
  },
  async ({ address }) => {
    const removed = wallets.remove(address)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ removed, address }, null, 2),
      }],
    }
  },
)

// ─── Market Tools ────────────────────────────────────────────────────────────

server.tool(
  'market_list',
  'List all active perpetual futures markets on Injective. Returns symbols, tickers, market IDs, and key parameters.',
  {},
  async () => {
    const list = await markets.list(config)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(list, null, 2),
      }],
    }
  },
)

server.tool(
  'market_price',
  'Get the current oracle price for a perpetual market by symbol (e.g. "BTC", "ETH").',
  {
    symbol: z.string().describe('Market symbol, e.g. "BTC" or "ETH".'),
  },
  async ({ symbol }) => {
    const market = await markets.resolve(config, symbol)
    const price = await markets.getPrice(config, market.marketId)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          symbol: market.symbol,
          ticker: market.ticker,
          marketId: market.marketId,
          price: price.toFixed(6),
        }, null, 2),
      }],
    }
  },
)

// ─── Account Tools ───────────────────────────────────────────────────────────

server.tool(
  'account_balances',
  'Get bank and subaccount balances for an Injective address.',
  {
    address: z.string().describe('The inj1... address to query.'),
  },
  async ({ address }) => {
    const balances = await accounts.getBalances(config, address)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(balances, null, 2),
      }],
    }
  },
)

server.tool(
  'account_positions',
  'Get all open perpetual positions and unrealized P&L for an address.',
  {
    address: z.string().describe('The inj1... address to query.'),
  },
  async ({ address }) => {
    const positions = await accounts.getPositions(config, address)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(positions, null, 2),
      }],
    }
  },
)

// ─── Trading Tools ───────────────────────────────────────────────────────────

server.tool(
  'trade_open',
  'Open a perpetual futures position with a market order. ' +
  'IMPORTANT: This executes a real on-chain transaction with real funds. ' +
  'Always confirm the parameters with the user before calling this tool. ' +
  'Returns txHash, execution price, quantity, margin, and liquidation price.',
  {
    address: z.string().describe('The inj1... address of the trading wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key for signing.'),
    symbol: z.string().describe('Market symbol, e.g. "BTC" or "ETH".'),
    side: z.enum(['long', 'short']).describe('long = buy the underlying, short = sell the underlying.'),
    amount: z.string().describe('Notional amount in USDT, e.g. "100" means a $100 position.'),
    leverage: z.number().min(1).max(50).optional().describe('Leverage multiplier. Default: 10.'),
    slippage: z.number().min(0).max(0.5).optional().describe('Max slippage as fraction. Default: 0.01 (1%).'),
  },
  async ({ address, password, symbol, side, amount, leverage, slippage }) => {
    const result = await trading.open(config, {
      address, password, symbol, side, amount, leverage, slippage,
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
  'trade_close',
  'Close an entire open perpetual position with a market order. ' +
  'IMPORTANT: This executes a real on-chain transaction. ' +
  'Confirm with the user before calling. Returns txHash, exit price, and realized P&L.',
  {
    address: z.string().describe('The inj1... address of the trading wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key for signing.'),
    symbol: z.string().describe('Market symbol of the position to close, e.g. "BTC".'),
    slippage: z.number().min(0).max(0.5).optional().describe('Max slippage as fraction. Default: 0.05 (5%).'),
  },
  async ({ address, password, symbol, slippage }) => {
    const result = await trading.close(config, {
      address, password, symbol, slippage,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
