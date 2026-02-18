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
export type { BankBalance, SubaccountBalance, Position, Balances } from './accounts/index.js'

export { trading } from './trading/index.js'
export type { OpenParams, OpenResult, CloseParams, CloseResult } from './trading/index.js'

export * from './errors/index.js'
