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
import { orders } from '../orders/index.js'
import { transfers } from '../transfers/index.js'
import { bridges } from '../bridges/index.js'
import { debridge } from '../bridges/debridge.js'
import { evm } from '../evm/index.js'
import { eip712 } from '../evm/eip712.js'
import { authz, TRADING_MSG_TYPES } from '../authz/index.js'

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

server.tool(
  'trade_limit_open',
  'Open a perpetual limit order. ' +
  'IMPORTANT: This executes a real on-chain transaction with real funds. ' +
  'Always confirm the parameters with the user before calling this tool.',
  {
    address: injAddress.describe('The inj1... address of the trading wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key for signing.'),
    symbol: z.string().describe('Perpetual market symbol, e.g. "BTC" or "ETH".'),
    side: z.enum(['buy', 'sell']).describe('buy = bid, sell = ask.'),
    price: numericString.describe('Limit price in quote units (USDT), e.g. "32000".'),
    quantity: numericString.describe('Base quantity, e.g. "0.01" for BTC.'),
    margin: numericString.describe('Order margin in USDT, e.g. "10".'),
    subaccountIndex: z.number().int().min(0).max(255).optional()
      .describe('Subaccount index. Default: 0.'),
    reduceOnly: z.boolean().optional().describe('Whether the limit order is reduce-only. Default: false.'),
    postOnly: z.boolean().optional().describe('Whether the order must rest on book. Default: false.'),
  },
  async ({ address, password, symbol, side, price, quantity, margin, subaccountIndex, reduceOnly, postOnly }) => {
    const result = await orders.tradeLimitOpen(config, {
      address,
      password,
      symbol,
      side,
      price,
      quantity,
      margin,
      subaccountIndex,
      reduceOnly,
      postOnly,
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
  'trade_limit_orders',
  'List open perpetual limit orders for an Injective address.',
  {
    address: injAddress.describe('The inj1... address of the wallet.'),
    symbol: z.string().optional().describe('Optional market symbol filter, e.g. "BTC".'),
    subaccountIndex: z.number().int().min(0).max(255).optional()
      .describe('Subaccount index. Default: 0.'),
  },
  async ({ address, symbol, subaccountIndex }) => {
    const result = await orders.tradeLimitOrders(config, {
      address,
      symbol,
      subaccountIndex,
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
  'trade_limit_close',
  'Cancel an existing perpetual limit order. ' +
  'IMPORTANT: This executes a real on-chain transaction. Confirm with the user before calling.',
  {
    address: injAddress.describe('The inj1... address of the trading wallet.'),
    password: z.string().describe('Keystore password to decrypt the private key for signing.'),
    symbol: z.string().describe('Perpetual market symbol, e.g. "BTC".'),
    subaccountIndex: z.number().int().min(0).max(255).optional()
      .describe('Subaccount index. Default: 0.'),
    orderHash: z.string().min(1).describe('Order hash selector.'),
  },
  async ({ address, password, symbol, subaccountIndex, orderHash }) => {
    const result = await orders.tradeLimitClose(config, {
      address,
      password,
      symbol,
      subaccountIndex,
      orderHash,
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
  'trade_limit_states',
  'Get perpetual derivative order states by order hash.',
  {
    derivativeOrderHashes: z.array(z.string().min(1)).min(1)
      .describe('Non-empty list of derivative order hashes to query.'),
  },
  async ({ derivativeOrderHashes }) => {
    const result = await orders.tradeLimitStates(config, {
      derivativeOrderHashes,
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

server.tool(
  'bridge_debridge_quote',
  'Get a deBridge DLN quote from Injective to another chain. ' +
  'Read-only: no transaction is broadcast. Supports destination chains like ethereum, bsc, polygon, arbitrum, avalanche, base, optimism, solana.',
  {
    srcDenom: z.string().min(1).describe('Source denom on Injective, e.g. "inj" or "erc20:0x...".'),
    amount: numericString.describe('Human-readable source amount, e.g. "1.5".'),
    dstChain: z.union([z.string(), z.number().int().positive()])
      .describe('Destination chain name or deBridge chain ID (e.g. "ethereum", "base", 1, 8453).'),
    dstTokenAddress: z.string().min(1)
      .describe('Destination token address/mint on destination chain.'),
    recipient: z.string().min(1)
      .describe('Recipient address on destination chain.'),
  },
  async ({ srcDenom, amount, dstChain, dstTokenAddress, recipient }) => {
    const result = await debridge.getQuote(config, {
      srcDenom,
      amount,
      dstChain,
      dstTokenAddress,
      recipient,
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
  'bridge_debridge_send',
  'Bridge tokens from Injective to another chain via deBridge DLN. ' +
  'IMPORTANT: Real cross-chain transaction, irreversible once submitted. Confirm parameters first.',
  {
    address: injAddress.describe('Sender inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    srcDenom: z.string().min(1).describe('Source denom on Injective, e.g. "inj" or "erc20:0x...".'),
    amount: numericString.describe('Human-readable amount to bridge.'),
    dstChain: z.union([z.string(), z.number().int().positive()])
      .describe('Destination chain name or deBridge chain ID.'),
    dstTokenAddress: z.string().min(1).describe('Destination token address/mint on destination chain.'),
    recipient: z.string().min(1).describe('Recipient address on destination chain.'),
    dstAuthorityAddress: z.string().min(1).optional()
      .describe('Optional destination authority address override. Default: recipient.'),
    gasLimit: z.union([z.number().int().positive(), numericString]).optional()
      .describe('Optional gas limit override for the EVM transaction.'),
    gasPrice: numericString.optional()
      .describe('Optional gas price override (wei). Default: current base fee.'),
    memo: z.string().optional().describe('Optional transaction memo.'),
  },
  async ({ address, password, srcDenom, amount, dstChain, dstTokenAddress, recipient, dstAuthorityAddress, gasLimit, gasPrice, memo }) => {
    const result = await debridge.sendBridge(config, {
      address,
      password,
      srcDenom,
      amount,
      dstChain,
      dstTokenAddress,
      recipient,
      dstAuthorityAddress,
      gasLimit,
      gasPrice,
      memo,
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
  'bridge_debridge_inbound_quote',
  'Get a deBridge DLN quote for bridging tokens FROM an external chain (e.g. Arbitrum, Ethereum, Base) ' +
  'INTO Injective. Read-only: no transaction is broadcast. ' +
  'Example: USDC on Arbitrum → USDT on Injective EVM.',
  {
    srcChain: z.union([z.string(), z.number().int().positive()])
      .describe('Source chain name or chain ID (e.g. "arbitrum", 42161, "base", 8453).'),
    srcTokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      .describe('ERC20 token address on the source chain (e.g. USDC on Arbitrum: 0xaf88d065e77c8cc2239327c5edb3a432268e5831).'),
    amount: numericString.describe('Human-readable amount to bridge (e.g. "10.5").'),
    dstTokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      .describe('Destination ERC20 token address on Injective EVM (e.g. USDT: 0x88f7f2b685f9692caf8c478f5badf09ee9b1cc13).'),
    recipient: z.string().min(1)
      .describe('Recipient on Injective: bech32 inj1... address or 0x EVM address.'),
  },
  async ({ srcChain, srcTokenAddress, amount, dstTokenAddress, recipient }) => {
    const result = await debridge.getQuoteInbound({
      srcChain,
      srcTokenAddress,
      amount,
      dstTokenAddress,
      recipient,
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
  'bridge_debridge_inbound_send',
  'Bridge tokens FROM an external chain (e.g. Arbitrum) INTO Injective via deBridge DLN. ' +
  'Uses the Injective wallet\'s private key to sign on the source chain (same secp256k1 key). ' +
  'Steps: (1) ERC20 approve on source chain, (2) bridge tx on source chain → tokens arrive on Injective. ' +
  'IMPORTANT: Real cross-chain transaction — irreversible once submitted. Confirm parameters first.',
  {
    address: injAddress.describe('Sender inj1... address (must be in local keystore). The same key is used on the source chain.'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    srcChain: z.union([z.string(), z.number().int().positive()])
      .describe('Source chain name or chain ID (e.g. "arbitrum", 42161).'),
    srcTokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      .describe('ERC20 token address on the source chain (e.g. USDC on Arbitrum).'),
    amount: numericString.describe('Human-readable amount to bridge (e.g. "10.5").'),
    dstTokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
      .describe('Destination ERC20 token address on Injective EVM.'),
    recipient: z.string().min(1)
      .describe('Recipient on Injective: bech32 inj1... address or 0x EVM address.'),
    rpcUrl: z.string().url().optional()
      .describe('Optional RPC URL override for the source chain. Public endpoints are used by default.'),
    srcAuthorityAddress: z.string().optional()
      .describe('Optional source-chain authority address override. Defaults to sender EVM address.'),
    dstAuthorityAddress: z.string().optional()
      .describe('Optional Injective-side authority address override. Defaults to recipient EVM address.'),
  },
  async ({ address, password, srcChain, srcTokenAddress, amount, dstTokenAddress, recipient, rpcUrl, srcAuthorityAddress, dstAuthorityAddress }) => {
    const result = await debridge.sendBridgeInbound({
      address,
      password,
      srcChain,
      srcTokenAddress,
      amount,
      dstTokenAddress,
      recipient,
      rpcUrl,
      srcAuthorityAddress,
      dstAuthorityAddress,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

// ─── Generic EVM Tool ──────────────────────────────────────────────────────

server.tool(
  'evm_broadcast',
  'Broadcast a raw EVM transaction on Injective EVM. ' +
  'IMPORTANT: Real on-chain transaction with real funds. Confirm parameters first.',
  {
    address: injAddress.describe('Sender inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    to: ethAddress.optional().describe('Destination 0x... contract/account. Omit for contract deployment.'),
    data: z.string().optional().describe('Hex calldata (0x-prefixed). Default: "0x".'),
    value: numericString.optional().describe('Value in wei as integer string. Default: "0".'),
    nonce: z.number().int().min(0).optional().describe('Optional nonce override. Default: next chain nonce.'),
    gasLimit: z.union([z.number().int().positive(), numericString]).optional()
      .describe('Optional gas limit override. Default: 300000.'),
    gasPrice: numericString.optional()
      .describe('Optional gas price in wei. Default: current base fee.'),
    chainId: z.number().int().positive().optional()
      .describe('Optional EVM chain ID override. Default: network chain config.'),
    memo: z.string().optional().describe('Optional memo.'),
  },
  async ({ address, password, to, data, value, nonce, gasLimit, gasPrice, chainId, memo }) => {
    const privateKeyHex = wallets.unlock(address, password)
    const result = await evm.broadcastEvmTx(config, {
      privateKeyHex,
      to,
      data,
      value,
      nonce,
      gasLimit,
      gasPrice,
      chainId,
      memo,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

// ─── EIP-712 Trading Tools ────────────────────────────────────────────────────

server.tool(
  'trade_open_eip712',
  'Open a perpetual futures position using EIP-712 Ethereum-style signing. ' +
  'Use this instead of trade_open if your wallet key is an Ethereum private key ' +
  '(e.g. exported from MetaMask or a hardware wallet). ' +
  'IMPORTANT: Real on-chain transaction with real funds. Confirm parameters with the user first.',
  {
    address: injAddress.describe('Sender inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    symbol: z.string().min(1).describe('Market ticker, e.g. "BTC", "ETH", "INJ".'),
    side: z.enum(['long', 'short']).describe('Position direction.'),
    amount: numericString.describe('Notional size in USDT, e.g. "100" = $100.'),
    leverage: z.number().int().min(1).max(50).optional()
      .describe('Leverage multiplier (default: 10).'),
    slippage: z.number().min(0).max(0.5).optional()
      .describe('Slippage tolerance as a fraction (default: 0.01 = 1%).'),
  },
  async ({ address, password, symbol, side, amount, leverage, slippage }) => {
    const result = await eip712.open(config, { address, password, symbol, side, amount, leverage, slippage })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

server.tool(
  'trade_close_eip712',
  'Close an open perpetual position using EIP-712 Ethereum-style signing. ' +
  'Use this instead of trade_close if your wallet key is an Ethereum private key ' +
  '(e.g. exported from MetaMask or a hardware wallet). ' +
  'IMPORTANT: Real on-chain transaction. Confirm with the user before calling.',
  {
    address: injAddress.describe('Sender inj1... address (must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the private key.'),
    symbol: z.string().min(1).describe('Market ticker of the position to close, e.g. "BTC".'),
    slippage: z.number().min(0).max(0.5).optional()
      .describe('Slippage tolerance as a fraction (default: 0.05 = 5%).'),
  },
  async ({ address, password, symbol, slippage }) => {
    const result = await eip712.close(config, { address, password, symbol, slippage })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  },
)

// ─── AuthZ Tools ─────────────────────────────────────────────────────────────

server.tool(
  'authz_grant',
  'Grant another Injective address permission to execute trading messages on your behalf ' +
  '(Cosmos SDK AuthZ). After granting, the grantee can submit trades using authz_exec-style ' +
  'flows without requiring your signature per transaction. ' +
  'IMPORTANT: This is a real on-chain transaction. Confirm parameters with the user first. ' +
  `Default message types covered: ${TRADING_MSG_TYPES.join(', ')}`,
  {
    granterAddress: injAddress.describe('Your inj1... address (granter — must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the granter private key.'),
    granteeAddress: injAddress.describe('The inj1... address being granted permissions (grantee).'),
    msgTypes: z.array(z.string().min(1)).optional()
      .describe('Message type URLs to grant. Omit to use all default trading types.'),
    expirySeconds: z.number().int().positive().optional()
      .describe('Grant validity in seconds from now. Default: 2592000 (30 days).'),
  },
  async ({ granterAddress, password, granteeAddress, msgTypes, expirySeconds }) => {
    const result = await authz.grant(config, {
      granterAddress, password, granteeAddress, msgTypes, expirySeconds,
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
  'authz_revoke',
  'Revoke previously granted trading permissions from a grantee address. ' +
  'IMPORTANT: This is a real on-chain transaction. Confirm parameters with the user first.',
  {
    granterAddress: injAddress.describe('Your inj1... address (granter — must be in local keystore).'),
    password: z.string().describe('Keystore password to decrypt the granter private key.'),
    granteeAddress: injAddress.describe('The inj1... address whose permissions will be revoked.'),
    msgTypes: z.array(z.string().min(1)).optional()
      .describe('Message type URLs to revoke. Omit to revoke all default trading types.'),
  },
  async ({ granterAddress, password, granteeAddress, msgTypes }) => {
    const result = await authz.revoke(config, {
      granterAddress, password, granteeAddress, msgTypes,
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
