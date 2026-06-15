import { Config } from '../config/index.js'
import { markets, type PerpMarket } from '../markets/index.js'
import { nativeInfo } from '../usdc/index.js'

const DEFAULT_RFQ_COLLECT_QUOTES_MS = 500

export interface RfqConstants {
  network: Config['network']
  contractAddress: string
  wsUrl: string
  takerStreamUrl: string
  gatewayUrl: string
  chainId: string
  evmChainId: number
  collectQuotesMs: number
}

export interface RfqMarketReadinessParams {
  quoteDenom?: string
  symbol?: string
}

export interface RfqMarketReadinessItem {
  symbol: string
  ticker: string
  marketId: string
  quoteDenom: string
  quoteDenomMatches: boolean
  tickerMatchesQuote: boolean
  rfqEligible: boolean
  minQuantityTick: string
  tickSize: string
  minNotional: string
}

export interface RfqMarketReadiness {
  constants: RfqConstants
  quoteDenom: string
  quoteSymbol: string
  markets: RfqMarketReadinessItem[]
  counts: {
    total: number
    eligible: number
    ineligible: number
  }
}

const RFQ_CONSTANTS_BY_NETWORK: Record<Config['network'], Omit<RfqConstants, 'network' | 'chainId' | 'evmChainId'>> = {
  mainnet: {
    contractAddress: 'inj12stwq95jet57edcu4a65r48r46s9rzrs938n8k',
    wsUrl: 'wss://rfq.ws.injective.network',
    takerStreamUrl: 'wss://rfq.ws.injective.network/injective_rfq_rpc.InjectiveRfqRPC/TakerStream',
    gatewayUrl: 'https://rfq.gateway.grpc-web.injective.network/',
    collectQuotesMs: DEFAULT_RFQ_COLLECT_QUOTES_MS,
  },
  testnet: {
    contractAddress: 'inj1vtswdey9c70n475q7q75wgmkfdw8xw4rcfeqa4',
    wsUrl: 'wss://testnet.rfq.ws.injective.network',
    takerStreamUrl: 'wss://testnet.rfq.ws.injective.network/injective_rfq_rpc.InjectiveRfqRPC/TakerStream',
    gatewayUrl: 'https://testnet.rfq.grpc.injective.network/injective_rfq_rpc.InjectiveRfqRPC',
    collectQuotesMs: DEFAULT_RFQ_COLLECT_QUOTES_MS,
  },
}

function normalizeDenom(denom: string): string {
  return denom.trim().toLowerCase()
}

function quoteSymbolFromDenom(quoteDenom: string): string {
  const lower = normalizeDenom(quoteDenom)
  if (lower === nativeInfo({
    network: 'mainnet',
    chainId: 'injective-1',
    ethereumChainId: 1776,
    endpoints: { indexer: '', grpc: '', rest: '' },
  }).denom || lower === nativeInfo({
    network: 'testnet',
    chainId: 'injective-888',
    ethereumChainId: 1439,
    endpoints: { indexer: '', grpc: '', rest: '' },
  }).denom) {
    return 'USDC'
  }
  if (lower.includes('usdt') || lower.startsWith('peggy0xdac17')) return 'USDT'
  return ''
}

export function getRfqConstants(config: Config): RfqConstants {
  const constants = RFQ_CONSTANTS_BY_NETWORK[config.network]
  return {
    network: config.network,
    chainId: config.chainId,
    evmChainId: config.ethereumChainId,
    ...constants,
  }
}

export function summarizeMarketReadiness(
  constants: RfqConstants,
  marketList: PerpMarket[],
  params: Required<RfqMarketReadinessParams>,
): RfqMarketReadiness {
  const quoteDenom = normalizeDenom(params.quoteDenom)
  const quoteSymbol = quoteSymbolFromDenom(quoteDenom)
  const symbolFilter = params.symbol.trim().toUpperCase()

  const items = marketList
    .filter(market => !symbolFilter || market.symbol.toUpperCase() === symbolFilter)
    .map((market): RfqMarketReadinessItem => {
      const marketQuoteDenom = normalizeDenom(market.quoteDenom)
      const quoteDenomMatches = !!marketQuoteDenom && marketQuoteDenom === quoteDenom
      const tickerMatchesQuote = !!quoteSymbol && market.ticker.toUpperCase().includes(`/${quoteSymbol}`)
      return {
        symbol: market.symbol,
        ticker: market.ticker,
        marketId: market.marketId,
        quoteDenom: market.quoteDenom,
        quoteDenomMatches,
        tickerMatchesQuote,
        rfqEligible: quoteDenomMatches || tickerMatchesQuote,
        minQuantityTick: market.minQuantityTick,
        tickSize: market.tickSize,
        minNotional: market.minNotional,
      }
    })

  const eligible = items.filter(item => item.rfqEligible).length
  return {
    constants,
    quoteDenom,
    quoteSymbol,
    markets: items.sort((a, b) => Number(b.rfqEligible) - Number(a.rfqEligible) || a.ticker.localeCompare(b.ticker)),
    counts: {
      total: items.length,
      eligible,
      ineligible: items.length - eligible,
    },
  }
}

export async function marketReadiness(
  config: Config,
  params: RfqMarketReadinessParams = {},
): Promise<RfqMarketReadiness> {
  const quoteDenom = params.quoteDenom ?? nativeInfo(config).denom
  const marketList = await markets.list(config)
  return summarizeMarketReadiness(getRfqConstants(config), marketList, {
    quoteDenom,
    symbol: params.symbol ?? '',
  })
}

export const rfq = {
  constants: getRfqConstants,
  marketReadiness,
  summarizeMarketReadiness,
}
