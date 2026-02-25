// Core library barrel export
// The integration layer (MCP, CLI, etc.) imports from here.

export { createConfig, validateNetwork } from './config/index.js'
export type { Config, NetworkName } from './config/index.js'

export { keystore } from './keystore/index.js'
export type { WalletEntry } from './keystore/index.js'

export { wallets } from './wallets/index.js'
export type { GenerateResult, ImportResult } from './wallets/index.js'

export { markets } from './markets/index.js'
export type { PerpMarket } from './markets/index.js'

export { accounts } from './accounts/index.js'
export type { BankBalance, SubaccountBalance, Position, Balances, DenomMeta, TokenType } from './accounts/index.js'

export { trading } from './trading/index.js'
export type { OpenParams, OpenResult, CloseParams, CloseResult } from './trading/index.js'

export { orders } from './orders/index.js'
export type { TradeLimitOpenParams, TradeLimitOpenResult, TradeLimitOrdersParams, TradeLimitOrder, TradeLimitCloseParams, TradeLimitCloseResult, TradeLimitStatesParams, TradeLimitOrderState } from './orders/index.js'

export { transfers } from './transfers/index.js'
export type { SendParams, SendResult, SubaccountDepositParams, SubaccountDepositResult, SubaccountWithdrawParams, SubaccountWithdrawResult } from './transfers/index.js'

export { bridges } from './bridges/index.js'
export type { PeggyWithdrawParams, PeggyWithdrawResult } from './bridges/index.js'
export { debridge } from './bridges/debridge.js'
export type { DeBridgeQuoteParams, DeBridgeQuoteResult, DeBridgeSendParams, DeBridgeSendResult } from './bridges/debridge.js'

export { evm } from './evm/index.js'
export type { EvmAccount, BroadcastEvmTxParams, BroadcastEvmTxResult } from './evm/index.js'

export { eip712 } from './evm/eip712.js'
export type { Eip712OpenParams, Eip712OpenResult, Eip712CloseParams, Eip712CloseResult } from './evm/eip712.js'

export * from './errors/index.js'
