/**
 * Integration smoke tests — runs against real Injective testnet or mainnet.
 *
 * Prerequisites:
 *   INJECTIVE_PRIVATE_KEY  — hex private key (0x-prefixed or bare)
 *   INJECTIVE_NETWORK      — 'mainnet' | 'testnet' (defaults to 'testnet')
 *
 * Run:
 *   INJECTIVE_PRIVATE_KEY=0x... npm run test:integration
 *
 * These tests hit real gRPC endpoints. They are read-only except for the
 * wallet keystore tests and the optional trade tests at the end.
 *
 * Trade tests are gated behind INJECTIVE_ALLOW_TRADES=true to prevent
 * accidental real-money trades.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrivateKey } from '@injectivelabs/sdk-ts'
import Decimal from 'decimal.js'

import { createConfig, validateNetwork } from '../config/index.js'
import type { Config, NetworkName } from '../config/index.js'
import { createClient, withRetry } from '../client/index.js'
import { wallets } from '../wallets/index.js'
import { markets } from '../markets/index.js'
import { accounts } from '../accounts/index.js'
import { trading } from '../trading/index.js'
import { orders } from '../orders/index.js'
import { MarketNotFound, NoPriceAvailable, WalletNotFound, WrongPassword, NoPositionFound, InvalidOrderStatesQuery } from '../errors/index.js'
import { getTestPrivateKey, getTestNetwork, INJ_ADDRESS_RE, TX_HASH_RE } from '../test-utils/index.js'

// ─── Setup ───────────────────────────────────────────────────────────────────

let config: Config
let address: string
let privateKeyHex: string
let network: NetworkName

const TEST_PASSWORD = 'integration-test-pw-2024!'
const WALLET_NAME = 'integration-test-wallet'

beforeAll(() => {
  privateKeyHex = getTestPrivateKey()
  network = getTestNetwork()
  config = createConfig(network)

  const pk = PrivateKey.fromHex(privateKeyHex)
  address = pk.toAddress().toAccountAddress()

  console.log(`\n🔗 Integration tests running on ${network}`)
  console.log(`📍 Address: ${address}`)
  console.log(`🌐 Indexer: ${config.endpoints.indexer}\n`)
})

// ─── Config ──────────────────────────────────────────────────────────────────

describe('config (integration)', () => {
  it('creates valid config for the test network', () => {
    expect(config.network).toBe(network)
    expect(config.chainId).toBeTruthy()
    expect(config.endpoints.indexer).toMatch(/^https?:\/\//)
    expect(config.endpoints.grpc).toMatch(/^https?:\/\//)
    expect(config.endpoints.rest).toMatch(/^https?:\/\//)
  })
})

// ─── Client ──────────────────────────────────────────────────────────────────

describe('client (integration)', () => {
  it('creates a client that can reach the indexer', async () => {
    const client = createClient(config)
    expect(client.network).toBe(network)
    expect(client.derivativesApi).toBeTruthy()
    expect(client.oracleApi).toBeTruthy()
    expect(client.portfolioApi).toBeTruthy()
    expect(client).toHaveProperty('accountApi')
  })

  it('withRetry resolves on successful call', async () => {
    const result = await withRetry(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })
})

// ─── Limit Orders (read-only portions) ──────────────────────────────────────

describe('limit orders read-only (integration)', () => {
  it('tradeLimitOrders returns an array (may be empty)', async () => {
    const list = await orders.tradeLimitOrders(config, { address, symbol: 'BTC' })
    expect(Array.isArray(list)).toBe(true)
  })

  it('tradeLimitStates validates non-empty hashes', async () => {
    await expect(
      orders.tradeLimitStates(config, { derivativeOrderHashes: [] })
    ).rejects.toThrow(InvalidOrderStatesQuery)
  })
})

// ─── Wallet Keystore ─────────────────────────────────────────────────────────

describe('wallet keystore (integration)', () => {
  let importedAddress: string

  afterAll(() => {
    // Clean up imported wallet
    if (importedAddress) {
      wallets.remove(importedAddress)
    }
  })

  it('imports the test wallet into keystore', () => {
    const result = wallets.import(privateKeyHex, TEST_PASSWORD, WALLET_NAME)
    importedAddress = result.address
    expect(result.address).toMatch(INJ_ADDRESS_RE)
    expect(result.address).toBe(address)
  })

  it('lists the imported wallet', () => {
    const list = wallets.list()
    const found = list.find(w => w.address === address)
    expect(found).toBeDefined()
    expect(found!.name).toBe(WALLET_NAME)
  })

  it('unlocks with correct password', () => {
    const pk = wallets.unlock(address, TEST_PASSWORD)
    expect(pk).toBeTruthy()
    // Verify the key derives the same address
    const derivedAddress = PrivateKey.fromHex(pk).toAddress().toAccountAddress()
    expect(derivedAddress).toBe(address)
  })

  it('throws WrongPassword on bad password', () => {
    expect(() => wallets.unlock(address, 'wrong-password')).toThrow(WrongPassword)
  })

  it('throws WalletNotFound for unknown address', () => {
    const fakeAddr = 'inj1' + 'z'.repeat(38)
    expect(() => wallets.unlock(fakeAddr, TEST_PASSWORD)).toThrow(WalletNotFound)
  })

  it('removes the wallet', () => {
    const removed = wallets.remove(address)
    expect(removed).toBe(true)
    importedAddress = '' // prevent afterAll cleanup

    // Re-import for remaining tests
    wallets.import(privateKeyHex, TEST_PASSWORD, WALLET_NAME)
    importedAddress = address
  })

  it('generates a new wallet and cleans up', () => {
    const result = wallets.generate(TEST_PASSWORD, 'ephemeral')
    expect(result.address).toMatch(INJ_ADDRESS_RE)
    expect(result.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)

    // Clean up
    wallets.remove(result.address)
  })
})

// ─── Markets ─────────────────────────────────────────────────────────────────

describe('markets (integration)', () => {
  it('lists active perpetual markets', async () => {
    const list = await markets.list(config, 0)
    expect(list.length).toBeGreaterThan(0)

    const first = list[0]!
    expect(first.symbol).toBeTruthy()
    expect(first.marketId).toMatch(/^0x[a-f0-9]+$/)
    expect(first.ticker).toContain('/')
    expect(first.maintenanceMarginRatio).toBeTruthy()
    expect(first.initialMarginRatio).toBeTruthy()
    expect(Number(first.tickSize)).toBeGreaterThan(0)
    expect(Number(first.minQuantityTick)).toBeGreaterThan(0)
    expect(first.quoteDecimals).toBe(6)
  })

  it('resolves BTC market by symbol', async () => {
    // BTC/USDT PERP should exist on both testnet and mainnet
    try {
      const market = await markets.resolve(config, 'BTC')
      expect(market.symbol).toBe('BTC')
      expect(market.ticker).toContain('BTC')
      expect(market.marketId).toMatch(/^0x/)
    } catch (err) {
      // BTC might not be on testnet — skip gracefully
      if (err instanceof MarketNotFound) {
        console.log('  ⚠️ BTC market not found, skipping resolve test')
        return
      }
      throw err
    }
  })

  it('resolves INJ market by symbol (case-insensitive)', async () => {
    try {
      const market = await markets.resolve(config, 'inj')
      expect(market.symbol.toUpperCase()).toBe('INJ')
    } catch (err) {
      if (err instanceof MarketNotFound) {
        console.log('  ⚠️ INJ market not found, skipping')
        return
      }
      throw err
    }
  })

  it('throws MarketNotFound for nonexistent symbol', async () => {
    await expect(markets.resolve(config, 'ZZZZNOTREAL')).rejects.toThrow(MarketNotFound)
  })

  it('gets oracle price for a real market', async () => {
    const list = await markets.list(config, 0)
    if (list.length === 0) {
      console.log('  ⚠️ No markets available, skipping price test')
      return
    }

    const market = list[0]!
    try {
      const price = await markets.getPrice(config, market.marketId)
      expect(price).toBeInstanceOf(Decimal)
      expect(price.toNumber()).toBeGreaterThan(0)
      console.log(`  📊 ${market.symbol} oracle price: $${price.toFixed(2)}`)
    } catch (err) {
      if (err instanceof NoPriceAvailable) {
        console.log(`  ⚠️ No oracle price for ${market.symbol}, skipping`)
        return
      }
      throw err
    }
  })

  it('gets prices for multiple markets', async () => {
    const list = await markets.list(config, 0)
    const firstThree = list.slice(0, 3)

    for (const market of firstThree) {
      try {
        const price = await markets.getPrice(config, market.marketId)
        expect(price.toNumber()).toBeGreaterThan(0)
        console.log(`  📊 ${market.symbol}: $${price.toFixed(2)}`)
      } catch (err) {
        if (err instanceof NoPriceAvailable) {
          console.log(`  ⚠️ No price for ${market.symbol}`)
          continue
        }
        throw err
      }
    }
  })

  it('market list results are cached on second call', async () => {
    // First call populates cache with long TTL
    const list1 = await markets.list(config, 60000)
    const list2 = await markets.list(config, 60000)
    // Should be the exact same array reference (cached)
    expect(list1).toBe(list2)
  })
})

// ─── Accounts ────────────────────────────────────────────────────────────────

describe('accounts (integration)', () => {
  it('fetches bank balances for the test address', async () => {
    const balances = await accounts.getBalances(config, address)

    expect(balances).toHaveProperty('bank')
    expect(balances).toHaveProperty('subaccount')
    expect(Array.isArray(balances.bank)).toBe(true)
    expect(Array.isArray(balances.subaccount)).toBe(true)

    console.log(`  💰 Bank balances: ${balances.bank.length} tokens`)
    for (const b of balances.bank) {
      console.log(`     ${b.symbol}: ${b.amount}`)
    }

    console.log(`  📦 Subaccounts: ${balances.subaccount.length}`)
    for (const s of balances.subaccount) {
      console.log(`     ${s.symbol}: total=${s.total}, available=${s.available}`)
    }
  })

  it('bank balance amounts are non-negative numeric strings', async () => {
    const balances = await accounts.getBalances(config, address)
    for (const b of balances.bank) {
      const amount = Number(b.amount)
      expect(Number.isNaN(amount)).toBe(false)
      expect(amount).toBeGreaterThanOrEqual(0)
    }
  })

  it('subaccount available <= total', async () => {
    const balances = await accounts.getBalances(config, address)
    for (const s of balances.subaccount) {
      const total = Number(s.total)
      const available = Number(s.available)
      expect(available).toBeLessThanOrEqual(total + 0.000001) // float tolerance
    }
  })

  it('fetches positions (may be empty)', async () => {
    const positions = await accounts.getPositions(config, address)

    expect(Array.isArray(positions)).toBe(true)
    console.log(`  📈 Open positions: ${positions.length}`)

    for (const pos of positions) {
      expect(pos.symbol).toBeTruthy()
      expect(pos.marketId).toMatch(/^0x/)
      expect(['long', 'short']).toContain(pos.side)
      expect(Number(pos.quantity)).toBeGreaterThan(0)
      expect(Number(pos.entryPrice)).toBeGreaterThan(0)
      expect(Number(pos.markPrice)).toBeGreaterThan(0)

      console.log(`     ${pos.symbol} ${pos.side}: qty=${pos.quantity}, entry=${pos.entryPrice}, mark=${pos.markPrice}, pnl=${pos.unrealizedPnl}`)
    }
  })

  it('returns empty balances for address with no activity', async () => {
    // Use a valid but likely-empty address
    const emptyAddr = 'inj1' + 'z'.repeat(38)
    const balances = await accounts.getBalances(config, emptyAddr)
    // Shouldn't throw, just return empty arrays
    expect(Array.isArray(balances.bank)).toBe(true)
    expect(Array.isArray(balances.subaccount)).toBe(true)
  })
})

// ─── Trading (read-only portions) ────────────────────────────────────────────

describe('trading read-only (integration)', () => {
  beforeAll(() => {
    // Ensure wallet is imported for trading tests
    try {
      wallets.import(privateKeyHex, TEST_PASSWORD, WALLET_NAME)
    } catch {
      // May already exist, that's fine
    }
  })

  it('trading.close throws NoPositionFound for symbol with no position', async () => {
    // Pick a market that the test account almost certainly has no position in
    const allMarkets = await markets.list(config, 0)
    if (allMarkets.length === 0) {
      console.log('  ⚠️ No markets, skipping')
      return
    }

    // Find a market we don't have a position in
    const positions = await accounts.getPositions(config, address)
    const posSymbols = new Set(positions.map(p => p.symbol.toUpperCase()))
    const noPositionMarket = allMarkets.find(m => !posSymbols.has(m.symbol.toUpperCase()))

    if (!noPositionMarket) {
      console.log('  ⚠️ Have positions in all markets, skipping')
      return
    }

    await expect(
      trading.close(config, {
        address,
        password: TEST_PASSWORD,
        symbol: noPositionMarket.symbol,
      })
    ).rejects.toThrow(NoPositionFound)
  })
})

// ─── Orderbook queries ───────────────────────────────────────────────────────

describe('orderbook (integration)', () => {
  it('fetches orderbook for a real market', async () => {
    const list = await markets.list(config, 0)
    if (list.length === 0) {
      console.log('  ⚠️ No markets, skipping')
      return
    }

    const market = list[0]!
    const client = createClient(config)
    const orderbook = await withRetry(() =>
      client.derivativesApi.fetchOrderbookV2(market.marketId)
    )

    expect(orderbook).toHaveProperty('buys')
    expect(orderbook).toHaveProperty('sells')

    const buyCount = orderbook.buys?.length ?? 0
    const sellCount = orderbook.sells?.length ?? 0
    console.log(`  📖 ${market.symbol} orderbook: ${buyCount} bids, ${sellCount} asks`)

    // Verify buy levels are price-sorted (descending — best bid first)
    if (orderbook.buys && orderbook.buys.length >= 2) {
      const firstBid = Number(orderbook.buys[0]!.price)
      const secondBid = Number(orderbook.buys[1]!.price)
      expect(firstBid).toBeGreaterThanOrEqual(secondBid)
    }

    // Verify sell levels are price-sorted (ascending — best ask first)
    if (orderbook.sells && orderbook.sells.length >= 2) {
      const firstAsk = Number(orderbook.sells[0]!.price)
      const secondAsk = Number(orderbook.sells[1]!.price)
      expect(firstAsk).toBeLessThanOrEqual(secondAsk)
    }
  })
})

// ─── Trade Execution (gated) ─────────────────────────────────────────────────

const ALLOW_TRADES = process.env['INJECTIVE_ALLOW_TRADES'] === 'true'
const TRADE_SYMBOL = process.env['INJECTIVE_TRADE_SYMBOL'] ?? 'INJ'
const TRADE_AMOUNT = process.env['INJECTIVE_TRADE_AMOUNT'] ?? '10' // $10 notional

describe.skipIf(!ALLOW_TRADES)('trade execution (integration)', () => {
  it('opens and closes a small long position', async () => {
    console.log(`\n  ⚠️ EXECUTING REAL TRADE: long ${TRADE_SYMBOL} $${TRADE_AMOUNT}`)

    // Ensure wallet is imported
    try {
      wallets.import(privateKeyHex, TEST_PASSWORD, WALLET_NAME)
    } catch { /* already exists */ }

    // Open position
    const openResult = await trading.open(config, {
      address,
      password: TEST_PASSWORD,
      symbol: TRADE_SYMBOL,
      side: 'long',
      amount: TRADE_AMOUNT,
      leverage: 10,
      slippage: 0.05,
    })

    console.log(`  ✅ Opened: txHash=${openResult.txHash.slice(0, 16)}...`)
    console.log(`     price=${openResult.executionPrice}, qty=${openResult.quantity}`)
    console.log(`     margin=${openResult.margin}, liqPrice=${openResult.liquidationPrice}`)

    expect(openResult.txHash).toMatch(TX_HASH_RE)
    expect(Number(openResult.executionPrice)).toBeGreaterThan(0)
    expect(Number(openResult.quantity)).toBeGreaterThan(0)
    expect(Number(openResult.margin)).toBeGreaterThan(0)

    // Wait a moment for the position to appear on-chain
    await new Promise(r => setTimeout(r, 3000))

    // Close position
    const closeResult = await trading.close(config, {
      address,
      password: TEST_PASSWORD,
      symbol: TRADE_SYMBOL,
      slippage: 0.05,
    })

    console.log(`  ✅ Closed: txHash=${closeResult.txHash.slice(0, 16)}...`)
    console.log(`     qty=${closeResult.closedQty}, exitPrice=${closeResult.exitPrice}`)
    console.log(`     realizedPnl=${closeResult.realizedPnl}`)

    expect(closeResult.txHash).toMatch(TX_HASH_RE)
    expect(Number(closeResult.closedQty)).toBeGreaterThan(0)
    expect(Number(closeResult.exitPrice)).toBeGreaterThan(0)
  }, 60000) // 60s timeout for trade execution

  it('opens and closes a small short position', async () => {
    console.log(`\n  ⚠️ EXECUTING REAL TRADE: short ${TRADE_SYMBOL} $${TRADE_AMOUNT}`)

    const openResult = await trading.open(config, {
      address,
      password: TEST_PASSWORD,
      symbol: TRADE_SYMBOL,
      side: 'short',
      amount: TRADE_AMOUNT,
      leverage: 10,
      slippage: 0.05,
    })

    console.log(`  ✅ Opened short: txHash=${openResult.txHash.slice(0, 16)}...`)
    expect(openResult.txHash).toMatch(TX_HASH_RE)

    await new Promise(r => setTimeout(r, 3000))

    const closeResult = await trading.close(config, {
      address,
      password: TEST_PASSWORD,
      symbol: TRADE_SYMBOL,
      slippage: 0.05,
    })

    console.log(`  ✅ Closed short: txHash=${closeResult.txHash.slice(0, 16)}...`)
    expect(closeResult.txHash).toMatch(TX_HASH_RE)
  }, 60000)
})

describe.skipIf(!ALLOW_TRADES)('limit order execution (integration)', () => {
  it('opens and closes a small limit order by orderHash', async () => {
    console.log(`\n  ⚠️ EXECUTING REAL LIMIT ORDER FLOW: ${TRADE_SYMBOL}`)

    const market = await markets.resolve(config, TRADE_SYMBOL)
    const oraclePrice = await markets.getPrice(config, market.marketId)
    const quantity = new Decimal(market.minQuantityTick)
    const limitPrice = oraclePrice.mul(0.95)
    const margin = limitPrice.mul(quantity).mul(0.2) // conservative > IMR for most perps
    const beforeOrders = await orders.tradeLimitOrders(config, {
      address,
      symbol: TRADE_SYMBOL,
    })
    const beforeHashes = new Set(beforeOrders.map(o => o.orderHash))

    const openResult = await orders.tradeLimitOpen(config, {
      address,
      password: TEST_PASSWORD,
      symbol: TRADE_SYMBOL,
      side: 'buy',
      price: limitPrice.toFixed(6),
      quantity: quantity.toFixed(18).replace(/\.?0+$/, ''),
      margin: margin.toFixed(6),
      postOnly: true,
    })

    expect(openResult.txHash).toMatch(TX_HASH_RE)
    const afterOrders = await orders.tradeLimitOrders(config, {
      address,
      symbol: TRADE_SYMBOL,
    })
    const createdOrder = afterOrders.find(o => !beforeHashes.has(o.orderHash))
    expect(createdOrder?.orderHash).toBeTruthy()

    const closeResult = await orders.tradeLimitClose(config, {
      address,
      password: TEST_PASSWORD,
      symbol: TRADE_SYMBOL,
      orderHash: createdOrder!.orderHash,
    })
    expect(closeResult.txHash).toMatch(TX_HASH_RE)
  }, 60000)
})

// ─── Full E2E flow (gated) ──────────────────────────────────────────────────

describe.skipIf(!ALLOW_TRADES)('full E2E flow (integration)', () => {
  it('wallet → market lookup → check balance → open → verify position → close', async () => {
    console.log('\n  🔄 Running full E2E flow...')

    // 1. Import wallet
    try {
      wallets.import(privateKeyHex, TEST_PASSWORD, 'e2e-test')
    } catch { /* exists */ }
    expect(wallets.list().some(w => w.address === address)).toBe(true)

    // 2. List markets and pick one
    const allMarkets = await markets.list(config, 0)
    expect(allMarkets.length).toBeGreaterThan(0)

    let tradeMarket = allMarkets.find(m => m.symbol.toUpperCase() === TRADE_SYMBOL.toUpperCase())
    if (!tradeMarket) {
      tradeMarket = allMarkets[0]!
      console.log(`  ⚠️ ${TRADE_SYMBOL} not found, using ${tradeMarket.symbol}`)
    }

    // 3. Get oracle price
    const price = await markets.getPrice(config, tradeMarket.marketId)
    console.log(`  📊 ${tradeMarket.symbol} price: $${price.toFixed(2)}`)

    // 4. Check balance
    const balances = await accounts.getBalances(config, address)
    const usdtBalance = balances.subaccount.find(s => s.symbol === 'USDT')
    console.log(`  💰 USDT available: ${usdtBalance?.available ?? '0'}`)

    // 5. Open position
    const openResult = await trading.open(config, {
      address,
      password: TEST_PASSWORD,
      symbol: tradeMarket.symbol,
      side: 'long',
      amount: TRADE_AMOUNT,
      leverage: 10,
      slippage: 0.05,
    })
    console.log(`  ✅ Opened ${tradeMarket.symbol} long: ${openResult.txHash.slice(0, 16)}...`)

    // 6. Wait for chain to process
    await new Promise(r => setTimeout(r, 5000))

    // 7. Verify position exists
    const positions = await accounts.getPositions(config, address)
    const ourPosition = positions.find(
      p => p.symbol.toUpperCase() === tradeMarket!.symbol.toUpperCase() && p.side === 'long'
    )
    expect(ourPosition).toBeDefined()
    console.log(`  📈 Position confirmed: qty=${ourPosition!.quantity}, pnl=${ourPosition!.unrealizedPnl}`)

    // 8. Close position
    const closeResult = await trading.close(config, {
      address,
      password: TEST_PASSWORD,
      symbol: tradeMarket.symbol,
      slippage: 0.05,
    })
    console.log(`  ✅ Closed: ${closeResult.txHash.slice(0, 16)}..., PnL=${closeResult.realizedPnl}`)

    expect(closeResult.txHash).toMatch(TX_HASH_RE)
  }, 90000) // 90s timeout for full flow
})

// ─── Cleanup ─────────────────────────────────────────────────────────────────

afterAll(() => {
  // Clean up imported wallet
  try {
    wallets.remove(address)
  } catch {
    // May not exist if test was skipped
  }
})
