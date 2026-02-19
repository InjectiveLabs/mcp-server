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

export class InvalidTransferAmount extends Error {
  readonly code = 'INVALID_TRANSFER_AMOUNT'
  constructor(reason: string) {
    super(`Invalid transfer amount: ${reason}`)
    this.name = 'InvalidTransferAmount'
  }
}

export class SelfTransferBlocked extends Error {
  readonly code = 'SELF_TRANSFER_BLOCKED'
  constructor() {
    super('Cannot send tokens to yourself')
    this.name = 'SelfTransferBlocked'
  }
}

export class UnknownDecimals extends Error {
  readonly code = 'UNKNOWN_DECIMALS'
  constructor(denom: string) {
    super(`Cannot convert amount for denom "${denom}" — decimals unknown. Use token_metadata to check.`)
    this.name = 'UnknownDecimals'
  }
}

export class InvalidBridgeDenom extends Error {
  readonly code = 'INVALID_BRIDGE_DENOM'
  constructor(denom: string) {
    super(`Denom "${denom}" is not bridgeable via Peggy. Only INJ and peggy-prefixed tokens are supported.`)
    this.name = 'InvalidBridgeDenom'
  }
}

export class EvmTxFailed extends Error {
  readonly code = 'EVM_TX_FAILED'
  constructor(reason: string) {
    super(`EVM transaction failed: ${reason}`)
    this.name = 'EvmTxFailed'
  }
}

export class DeBridgeApiError extends Error {
  readonly code = 'DEBRIDGE_API_ERROR'
  constructor(reason: string) {
    super(`deBridge API error: ${reason}`)
    this.name = 'DeBridgeApiError'
  }
}

export class UnsupportedBridgeChain extends Error {
  readonly code = 'UNSUPPORTED_BRIDGE_CHAIN'
  constructor(chain: string | number) {
    super(`Unsupported bridge destination chain: ${String(chain)}`)
    this.name = 'UnsupportedBridgeChain'
  }
}

export class InvalidOrderStatesQuery extends Error {
  readonly code = 'INVALID_ORDER_STATES_QUERY'
  constructor() {
    super('derivativeOrderHashes must be a non-empty array.')
    this.name = 'InvalidOrderStatesQuery'
  }
}

export class InvalidOrderParameters extends Error {
  readonly code = 'INVALID_ORDER_PARAMETERS'
  constructor(reason: string) {
    super(`Invalid order parameters: ${reason}`)
    this.name = 'InvalidOrderParameters'
  }
}
