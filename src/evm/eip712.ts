/**
 * EIP-712 trading module — open and close perpetual positions using
 * Ethereum-style signing (EIP-712 / eth_signTypedData_v4).
 *
 * This mirrors the MetaMask signing flow used in browser frontends, but runs
 * entirely server-side using ethers.js Wallet.signTypedData(). Users whose
 * private keys are Ethereum-format (MetaMask exports, hardware wallets, etc.)
 * can use these tools instead of the standard Cosmos-signed trade_open/close.
 *
 * Signing flow:
 *   1. Decrypt private key from keystore
 *   2. Build MsgCreateDerivativeMarketOrder
 *   3. Generate EIP-712 typed data via getEip712TypedData
 *   4. Sign with ethers.Wallet.signTypedData (equivalent to MetaMask eth_signTypedData_v4)
 *   5. Assemble TxRaw with EIP-712 extension + web3 extension
 *   6. Broadcast via TxGrpcApi
 */
import Decimal from 'decimal.js'
import { Wallet } from 'ethers'
import {
  MsgCreateDerivativeMarketOrder,
  OrderTypeMap,
  Address,
  getEip712TypedData,
  createTxRawEIP712,
  createWeb3Extension,
  createTransaction,
  SIGN_AMINO,
  ChainRestAuthApi,
  ChainRestTendermintApi,
} from '@injectivelabs/sdk-ts'
import type { EvmChainId } from '@injectivelabs/ts-types'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { markets } from '../markets/index.js'
import { accounts } from '../accounts/index.js'
import { createClient } from '../client/index.js'
import { BroadcastFailed, NoLiquidity, NoPositionFound, QuantityTooSmall } from '../errors/index.js'
import {
  walkOrderbook,
  applySlippage,
  calcMargin,
  calcLiquidationPrice,
  quantize,
} from '../trading/math.js'

const USDT_DECIMALS = 6
const QUOTE_SCALE = new Decimal(10).pow(USDT_DECIMALS)
const TIMEOUT_BLOCKS = 20

const DEFAULT_LEVERAGE = 10
const DEFAULT_OPEN_SLIPPAGE = 0.01
const DEFAULT_CLOSE_SLIPPAGE = 0.05

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fromChainPrice(chainPrice: Decimal): Decimal {
  return chainPrice.div(QUOTE_SCALE)
}

function toChainPrice(humanPrice: Decimal, tickSize: Decimal): string {
  return quantize(humanPrice.mul(QUOTE_SCALE), tickSize).toFixed(0, Decimal.ROUND_DOWN)
}

function toChainQuantity(humanQty: Decimal, tickSize: Decimal): string {
  const q = quantize(humanQty, tickSize)
  return q.toFixed(18).replace(/\.?0+$/, '') || '0'
}

function usdtToBase(amount: Decimal): string {
  return amount.mul(QUOTE_SCALE).toFixed(0, Decimal.ROUND_DOWN)
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Placeholder pubkey for new accounts whose pubkey isn't yet on-chain. */
function ethereumPubkeyPlaceholder(): string {
  return btoa(String.fromCharCode(...new Uint8Array(33)))
}

async function getAccountDetails(restEndpoint: string, injAddress: string) {
  const authApi = new ChainRestAuthApi(restEndpoint)
  const account = await authApi.fetchAccount(injAddress)
  const base = account.account.base_account
  return {
    accountNumber: parseInt(base.account_number, 10),
    sequence: parseInt(base.sequence, 10),
    pubKey: base.pub_key?.key ?? '',
  }
}

async function getTimeoutHeight(restEndpoint: string): Promise<number> {
  const tendermintApi = new ChainRestTendermintApi(restEndpoint)
  const block = await tendermintApi.fetchLatestBlock()
  return parseInt(block.header.height, 10) + TIMEOUT_BLOCKS
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Eip712OpenParams {
  address: string
  password: string
  symbol: string
  side: 'long' | 'short'
  /** Notional amount in USDT */
  amount: number | string
  leverage?: number
  slippage?: number
}

export interface Eip712OpenResult {
  txHash: string
  executionPrice: string
  quantity: string
  margin: string
  liquidationPrice: string
}

export interface Eip712CloseParams {
  address: string
  password: string
  symbol: string
  slippage?: number
}

export interface Eip712CloseResult {
  txHash: string
  closedQty: string
  exitPrice: string
  realizedPnl: string
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export const eip712 = {
  async open(config: Config, params: Eip712OpenParams): Promise<Eip712OpenResult> {
    const {
      address,
      password,
      symbol,
      side,
      leverage = DEFAULT_LEVERAGE,
      slippage = DEFAULT_OPEN_SLIPPAGE,
    } = params
    const notional = new Decimal(params.amount)
    const leverageDec = new Decimal(leverage)
    const slippageDec = new Decimal(slippage)

    // 1. Decrypt key and derive Ethereum address + subaccount
    const privateKeyHex = wallets.unlock(address, password)
    const ethWallet = new Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`)
    const subaccountId = Address.fromHex(ethWallet.address).getSubaccountId(0)

    // 2. Resolve market
    const market = await markets.resolve(config, symbol)

    // 3. Oracle price + orderbook
    const oraclePrice = await markets.getPrice(config, market.marketId)
    const client = createClient(config)
    const orderbook = await client.derivativesApi.fetchOrderbookV2(market.marketId)

    const isBuy = side === 'long'
    const levels = isBuy ? (orderbook.sells ?? []) : (orderbook.buys ?? [])
    if (levels.length === 0) throw new NoLiquidity(market.marketId)

    const orderbookLevels = levels.map(l => ({
      price: fromChainPrice(new Decimal(l.price)),
      quantity: new Decimal(l.quantity),
    }))

    const worstFillPrice = walkOrderbook(orderbookLevels, notional)
    const executionPrice = worstFillPrice.eq(0) ? oraclePrice : worstFillPrice
    const priceWithSlippage = applySlippage(executionPrice, slippageDec, side)

    // 4. Quantize price + quantity
    const tickSize = new Decimal(market.tickSize)
    const qtyTickSize = new Decimal(market.minQuantityTick)
    const chainPrice = toChainPrice(priceWithSlippage, tickSize)
    const humanQty = notional.div(executionPrice)
    const chainQty = toChainQuantity(humanQty, qtyTickSize)
    if (chainQty === '0') throw new QuantityTooSmall(market.minQuantityTick)

    const marginHuman = calcMargin(priceWithSlippage, humanQty, leverageDec)
    const chainMargin = usdtToBase(marginHuman)

    // 5. Build message
    const msg = MsgCreateDerivativeMarketOrder.fromJSON({
      marketId: market.marketId,
      subaccountId,
      injectiveAddress: address,
      orderType: isBuy ? OrderTypeMap.BUY : OrderTypeMap.SELL,
      price: chainPrice,
      margin: chainMargin,
      quantity: chainQty,
      feeRecipient: address,
    })

    // 6. Account state + block height (parallel)
    const [acct, timeoutHeight] = await Promise.all([
      getAccountDetails(config.endpoints.rest, address),
      getTimeoutHeight(config.endpoints.rest),
    ])

    // 7. Generate EIP-712 typed data
    const typedData = getEip712TypedData({
      msgs: msg,
      tx: {
        accountNumber: acct.accountNumber.toString(),
        sequence: acct.sequence.toString(),
        timeoutHeight: timeoutHeight.toString(),
        chainId: config.chainId,
        memo: `open ${side} ${symbol}`,
      },
      evmChainId: config.ethereumChainId as unknown as EvmChainId,
    }) as { domain: Record<string, unknown>; types: Record<string, unknown[]>; message: Record<string, unknown> }

    // 8. Sign — ethers.signTypedData requires EIP712Domain stripped from types
    const { EIP712Domain: _ignored, ...signingTypes } = typedData.types
    const sig = await ethWallet.signTypedData(
      typedData.domain as Parameters<Wallet['signTypedData']>[0],
      signingTypes as Parameters<Wallet['signTypedData']>[1],
      typedData.message,
    )

    // 9. Assemble TxRaw with EIP-712 extension and broadcast
    const { txRaw } = createTransaction({
      message: msg,
      memo: `open ${side} ${symbol}`,
      pubKey: acct.pubKey || ethereumPubkeyPlaceholder(),
      sequence: acct.sequence,
      accountNumber: acct.accountNumber,
      chainId: config.chainId,
      timeoutHeight,
      signMode: SIGN_AMINO,
    })

    const web3Extension = createWeb3Extension({
      evmChainId: config.ethereumChainId as unknown as EvmChainId,
    })
    const txRawEip712 = createTxRawEIP712(txRaw, web3Extension)
    txRawEip712.signatures = [hexToBytes(sig)]

    const response = await client.txApi.broadcast(txRawEip712)
    if (response.code !== 0) {
      throw new BroadcastFailed(`code ${response.code}: ${response.rawLog}`)
    }

    const maintenanceMarginRatio = new Decimal(market.maintenanceMarginRatio)
    const liqPrice = calcLiquidationPrice(executionPrice, leverageDec, maintenanceMarginRatio, side)

    return {
      txHash: response.txHash,
      executionPrice: executionPrice.toFixed(6),
      quantity: humanQty.toFixed(6),
      margin: marginHuman.toFixed(6),
      liquidationPrice: liqPrice.toFixed(6),
    }
  },

  async close(config: Config, params: Eip712CloseParams): Promise<Eip712CloseResult> {
    const {
      address,
      password,
      symbol,
      slippage = DEFAULT_CLOSE_SLIPPAGE,
    } = params
    const slippageDec = new Decimal(slippage)

    // 1. Decrypt key
    const privateKeyHex = wallets.unlock(address, password)
    const ethWallet = new Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`)

    // 2. Find open position — use its actual subaccountId, not hardcoded index 0
    const openPositions = await accounts.getPositions(config, address)
    const position = openPositions.find(p => p.symbol.toUpperCase() === symbol.toUpperCase())
    if (!position) throw new NoPositionFound(symbol)
    const subaccountId = position.subaccountId

    // 3. Resolve market + orderbook
    const market = await markets.resolve(config, symbol)
    const client = createClient(config)
    const orderbook = await client.derivativesApi.fetchOrderbookV2(market.marketId)

    const isClosingLong = position.side === 'long'
    const closeSide: 'long' | 'short' = isClosingLong ? 'short' : 'long'
    const levels = isClosingLong ? (orderbook.buys ?? []) : (orderbook.sells ?? [])
    if (levels.length === 0) throw new NoLiquidity(market.marketId)

    const orderbookLevels = levels.map(l => ({
      price: fromChainPrice(new Decimal(l.price)),
      quantity: new Decimal(l.quantity),
    }))

    const positionQty = new Decimal(position.quantity)
    const positionNotional = positionQty.mul(new Decimal(position.markPrice))
    const worstFillPrice = walkOrderbook(orderbookLevels, positionNotional)
    const exitPrice = worstFillPrice.eq(0) ? new Decimal(position.markPrice) : worstFillPrice
    const exitPriceWithSlippage = applySlippage(exitPrice, slippageDec, closeSide)

    const tickSize = new Decimal(market.tickSize)
    const qtyTickSize = new Decimal(market.minQuantityTick)
    const chainPrice = toChainPrice(exitPriceWithSlippage, tickSize)
    const chainQty = toChainQuantity(positionQty, qtyTickSize)
    if (chainQty === '0') throw new QuantityTooSmall(market.minQuantityTick)

    // Reduce-only close — no new margin posted
    const msg = MsgCreateDerivativeMarketOrder.fromJSON({
      marketId: market.marketId,
      subaccountId,
      injectiveAddress: address,
      orderType: isClosingLong ? OrderTypeMap.SELL : OrderTypeMap.BUY,
      price: chainPrice,
      margin: '0',
      quantity: chainQty,
      feeRecipient: address,
    })

    const [acct, timeoutHeight] = await Promise.all([
      getAccountDetails(config.endpoints.rest, address),
      getTimeoutHeight(config.endpoints.rest),
    ])

    const typedData = getEip712TypedData({
      msgs: msg,
      tx: {
        accountNumber: acct.accountNumber.toString(),
        sequence: acct.sequence.toString(),
        timeoutHeight: timeoutHeight.toString(),
        chainId: config.chainId,
        memo: `close ${symbol}`,
      },
      evmChainId: config.ethereumChainId as unknown as EvmChainId,
    }) as { domain: Record<string, unknown>; types: Record<string, unknown[]>; message: Record<string, unknown> }

    const { EIP712Domain: _ignored, ...signingTypes } = typedData.types
    const sig = await ethWallet.signTypedData(
      typedData.domain as Parameters<Wallet['signTypedData']>[0],
      signingTypes as Parameters<Wallet['signTypedData']>[1],
      typedData.message,
    )

    const { txRaw } = createTransaction({
      message: msg,
      memo: `close ${symbol}`,
      pubKey: acct.pubKey || ethereumPubkeyPlaceholder(),
      sequence: acct.sequence,
      accountNumber: acct.accountNumber,
      chainId: config.chainId,
      timeoutHeight,
      signMode: SIGN_AMINO,
    })

    const web3Extension = createWeb3Extension({
      evmChainId: config.ethereumChainId as unknown as EvmChainId,
    })
    const txRawEip712 = createTxRawEIP712(txRaw, web3Extension)
    txRawEip712.signatures = [hexToBytes(sig)]

    const response = await client.txApi.broadcast(txRawEip712)
    if (response.code !== 0) {
      throw new BroadcastFailed(`code ${response.code}: ${response.rawLog}`)
    }

    const entryPrice = new Decimal(position.entryPrice)
    const direction = position.side === 'long' ? 1 : -1
    const realizedPnl = exitPriceWithSlippage.minus(entryPrice).mul(positionQty).mul(direction)

    return {
      txHash: response.txHash,
      closedQty: positionQty.toFixed(6),
      exitPrice: exitPriceWithSlippage.toFixed(6),
      realizedPnl: realizedPnl.toFixed(6),
    }
  },
}
