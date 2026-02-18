export class WalletNotFound extends Error {
  readonly code = 'WALLET_NOT_FOUND'
  constructor(address: string) {
    super(`Wallet not found for address: ${address}`)
    this.name = 'WalletNotFound'
  }
}

export class WrongPassword extends Error {
  readonly code = 'WRONG_PASSWORD'
  constructor() {
    super('Incorrect password — keystore decryption failed')
    this.name = 'WrongPassword'
  }
}

export class MarketNotFound extends Error {
  readonly code = 'MARKET_NOT_FOUND'
  constructor(symbol: string) {
    super(`No active perpetual market found for symbol: ${symbol}`)
    this.name = 'MarketNotFound'
  }
}

export class NoPriceAvailable extends Error {
  readonly code = 'NO_PRICE_AVAILABLE'
  constructor(marketId: string) {
    super(`Oracle returned no price for market: ${marketId}`)
    this.name = 'NoPriceAvailable'
  }
}

export class NoLiquidity extends Error {
  readonly code = 'NO_LIQUIDITY'
  constructor(marketId: string) {
    super(`Orderbook has no liquidity for market: ${marketId}`)
    this.name = 'NoLiquidity'
  }
}

export class QuantityTooSmall extends Error {
  readonly code = 'QUANTITY_TOO_SMALL'
  constructor(minTick: string) {
    super(`Order quantity rounds to zero — minimum tick size is ${minTick}`)
    this.name = 'QuantityTooSmall'
  }
}

export class NoPositionFound extends Error {
  readonly code = 'NO_POSITION_FOUND'
  constructor(symbol: string) {
    super(`No open position found for symbol: ${symbol}`)
    this.name = 'NoPositionFound'
  }
}

export class InsufficientBalance extends Error {
  readonly code = 'INSUFFICIENT_BALANCE'
  constructor(required: string, available: string) {
    super(`Insufficient balance — required ${required}, available ${available}`)
    this.name = 'InsufficientBalance'
  }
}

export class BroadcastFailed extends Error {
  readonly code = 'BROADCAST_FAILED'
  constructor(reason: string) {
    super(`Transaction broadcast failed: ${reason}`)
    this.name = 'BroadcastFailed'
  }
}
