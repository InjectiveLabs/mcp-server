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
import { createConfig, validateNetwork } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { markets } from '../markets/index.js'
import { accounts } from '../accounts/index.js'
import { trading } from '../trading/index.js'
import { transfers } from '../transfers/index.js'
import { bridges } from '../bridges/index.js'

const injAddress = z.string().regex(/^inj1[a-z0-9]{38}$/, 'Must be a valid inj1... address (42 chars)')
const numericString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive numeric string')

const server = new McpServer({
  name: 'injective-agent',
  version: '0.1.0',
})

// ─── Config ─────────────────────────────────────────────────────────────────

const NETWORK = validateNetwork(process.env['INJECTIVE_NETWORK'] ?? 'testnet')
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
    address: injAddress.describe('The inj1... address of the wallet to remove.'),
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
  'Get bank and subaccount balances for an Injective address. ' +
  'Supports all token types: native (INJ), peggy, IBC, factory, and MTS (erc20:0x...) tokens. ' +
  'Automatically resolves token symbols and decimals from on-chain metadata.',
  {
    address: injAddress.describe('The inj1... address to query.'),
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
    address: injAddress.describe('The inj1... address to query.'),
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

// ─── Token Tools ────────────────────────────────────────────────────────────

server.tool(
  'token_metadata',
  'Look up token metadata (symbol, decimals, type) for a bank denom. ' +
  'Supports native (inj), peggy, IBC, factory, and MTS (erc20:0x...) denoms. ' +
  'Resolves metadata from on-chain denom registry when available.',
  {
    denom: z.string().min(1).describe('The bank denom to look up, e.g. "inj", "peggy0x...", "erc20:0x..."'),
  },
  async ({ denom }) => {
    const meta = await accounts.getDenomMetadata(config, denom)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          denom,
          symbol: meta.symbol,
          decimals: meta.decimals,
          tokenType: meta.tokenType,
        }, null, 2),
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
    address: injAddress.describe('The inj1... address of the trading wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key for signing.'),
    symbol: z.string().describe('Market symbol, e.g. "BTC" or "ETH".'),
    side: z.enum(['long', 'short']).describe('long = buy the underlying, short = sell the underlying.'),
    amount: numericString.describe('Notional amount in USDT, e.g. "100" means a $100 position.'),
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
    address: injAddress.describe('The inj1... address of the trading wallet.'),
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

// ─── Transfer Tools ─────────────────────────────────────────────────────────

const ethAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x... Ethereum address (42 chars)')

server.tool(
  'transfer_send',
  'Send tokens to another Injective address. ' +
  'IMPORTANT: This executes a real on-chain transaction. Confirm with the user first. ' +
  'Supports all token types: INJ, USDT, IBC tokens, factory tokens, MTS (erc20:0x...) tokens.',
  {
    address: injAddress.describe('Sender inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    recipient: injAddress.describe('Recipient inj1... address.'),
    denom: z.string().min(1).describe('Token denom to send, e.g. "inj", "peggy0x...", "erc20:0x..."'),
    amount: numericString.describe('Human-readable amount to send, e.g. "1.5" for 1.5 INJ.'),
  },
  async ({ address, password, recipient, denom, amount }) => {
    const result = await transfers.send(config, {
      address, password, recipient, denom, amount,
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
  'subaccount_deposit',
  'Deposit tokens from bank balance into a trading subaccount. ' +
  'IMPORTANT: Real on-chain transaction. Required before opening perpetual positions. ' +
  'Confirm with the user first.',
  {
    address: injAddress.describe('The inj1... address of the wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    denom: z.string().min(1).describe('Token denom to deposit, e.g. "peggy0x..." for USDT.'),
    amount: numericString.describe('Human-readable amount to deposit.'),
    subaccountIndex: z.number().int().min(0).max(255).optional()
      .describe('Subaccount index. Default: 0 (primary trading subaccount).'),
  },
  async ({ address, password, denom, amount, subaccountIndex }) => {
    const result = await transfers.deposit(config, {
      address, password, denom, amount, subaccountIndex,
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
  'subaccount_withdraw',
  'Withdraw tokens from a trading subaccount back to bank balance. ' +
  'IMPORTANT: Real on-chain transaction. Funds locked in positions cannot be withdrawn. ' +
  'Confirm with the user first.',
  {
    address: injAddress.describe('The inj1... address of the wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    denom: z.string().min(1).describe('Token denom to withdraw.'),
    amount: numericString.describe('Human-readable amount to withdraw.'),
    subaccountIndex: z.number().int().min(0).max(255).optional()
      .describe('Subaccount index. Default: 0 (primary trading subaccount).'),
  },
  async ({ address, password, denom, amount, subaccountIndex }) => {
    const result = await transfers.withdraw(config, {
      address, password, denom, amount, subaccountIndex,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

// ─── Bridge Tools ───────────────────────────────────────────────────────────

server.tool(
  'bridge_withdraw_to_eth',
  'Withdraw tokens from Injective to an Ethereum address via the Peggy bridge. ' +
  'IMPORTANT: Real cross-chain transaction. Bridge fee applies. Processing takes ~30 min. ' +
  'Only supports peggy-bridged tokens (INJ, USDT, etc). Cannot be reversed once submitted. ' +
  'Confirm all parameters with the user before calling.',
  {
    address: injAddress.describe('Sender inj1... address.'),
    password: z.string().describe('Keystore password.'),
    ethRecipient: ethAddress.describe('Recipient 0x... Ethereum address.'),
    denom: z.string().min(1).describe('Token denom to withdraw (must be INJ or peggy-prefixed).'),
    amount: numericString.describe('Human-readable amount to withdraw.'),
    bridgeFee: numericString.optional().describe('Bridge fee in same denom (human-readable). Default: auto-minimum.'),
  },
  async ({ address, password, ethRecipient, denom, amount, bridgeFee }) => {
    const result = await bridges.withdrawToEth(config, {
      address, password, ethRecipient, denom, amount, bridgeFee,
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
