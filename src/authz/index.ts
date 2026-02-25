/**
 * AuthZ module — grant and revoke Cosmos SDK authorizations.
 *
 * Allows one address (granter) to delegate specific message types to another
 * address (grantee) so the grantee can execute those messages on behalf of the
 * granter via MsgExec — without requiring the granter to sign each transaction.
 *
 * Primary use-case: grant an agent/bot wallet trading permissions so it can
 * execute orders on your behalf without needing your key per-trade.
 */
import {
  MsgGrant,
  MsgRevoke,
  getGenericAuthorizationFromMessageType,
} from '@injectivelabs/sdk-ts'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { createBroadcaster } from '../client/index.js'
import { BroadcastFailed } from '../errors/index.js'

/** Default trading message types covered by a grant. */
export const TRADING_MSG_TYPES = [
  '/injective.exchange.v1beta1.MsgCreateDerivativeMarketOrder',
  '/injective.exchange.v1beta1.MsgCreateDerivativeLimitOrder',
  '/injective.exchange.v1beta1.MsgCancelDerivativeOrder',
  '/injective.exchange.v1beta1.MsgBatchUpdateOrders',
  '/injective.exchange.v1beta1.MsgIncreasePositionMargin',
  '/injective.exchange.v1beta1.MsgCreateSpotMarketOrder',
  '/injective.exchange.v1beta1.MsgCreateSpotLimitOrder',
  '/injective.exchange.v1beta1.MsgCancelSpotOrder',
]

/** Default grant duration: 30 days. */
const DEFAULT_EXPIRY_S = 60 * 60 * 24 * 30

export interface GrantParams {
  /** Granter address (must be in local keystore). */
  granterAddress: string
  /** Keystore password for the granter. */
  password: string
  /** Grantee address (who will be allowed to execute on behalf of granter). */
  granteeAddress: string
  /** Message types to grant. Defaults to all TRADING_MSG_TYPES. */
  msgTypes?: string[]
  /** Grant validity in seconds from now. Default: 30 days. */
  expirySeconds?: number
}

export interface GrantResult {
  txHash: string
  granter: string
  grantee: string
  msgTypes: string[]
  expiresAt: string
}

export interface RevokeParams {
  /** Granter address (must be in local keystore). */
  granterAddress: string
  /** Keystore password for the granter. */
  password: string
  /** Grantee address whose permissions will be revoked. */
  granteeAddress: string
  /** Message types to revoke. Defaults to all TRADING_MSG_TYPES. */
  msgTypes?: string[]
}

export interface RevokeResult {
  txHash: string
  granter: string
  grantee: string
  msgTypes: string[]
}

export const authz = {
  async grant(config: Config, params: GrantParams): Promise<GrantResult> {
    const {
      granterAddress,
      password,
      granteeAddress,
      msgTypes = TRADING_MSG_TYPES,
      expirySeconds = DEFAULT_EXPIRY_S,
    } = params

    const privateKeyHex = wallets.unlock(granterAddress, password)
    const expiration = Math.floor(Date.now() / 1000) + expirySeconds

    const msgs = msgTypes.map(msgType =>
      MsgGrant.fromJSON({
        granter:       granterAddress,
        grantee:       granteeAddress,
        authorization: getGenericAuthorizationFromMessageType(msgType),
        expiration,
      })
    )

    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({ msgs, memo: 'authz grant' })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return {
      txHash,
      granter:   granterAddress,
      grantee:   granteeAddress,
      msgTypes,
      expiresAt: new Date(expiration * 1000).toISOString(),
    }
  },

  async revoke(config: Config, params: RevokeParams): Promise<RevokeResult> {
    const {
      granterAddress,
      password,
      granteeAddress,
      msgTypes = TRADING_MSG_TYPES,
    } = params

    const privateKeyHex = wallets.unlock(granterAddress, password)

    const msgs = msgTypes.map(msgType =>
      MsgRevoke.fromJSON({
        granter:     granterAddress,
        grantee:     granteeAddress,
        messageType: msgType,
      })
    )

    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({ msgs, memo: 'authz revoke' })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return {
      txHash,
      granter:  granterAddress,
      grantee:  granteeAddress,
      msgTypes,
    }
  },
}
