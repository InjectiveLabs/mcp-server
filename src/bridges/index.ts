/**
 * Bridges module — cross-chain token bridging via Peggy (Ethereum ↔ Injective).
 *
 * Covers:
 * - Peggy withdrawals (Injective → Ethereum via MsgSendToEth)
 *
 * NOT covered (out of scope):
 * - Peggy deposits (Ethereum → Injective) — requires Ethereum key management
 * - LayerZero OFT bridging — requires EVM tx research (Phase 5C)
 *
 * Security: Private keys are decrypted, used to sign, then discarded.
 */
import Decimal from 'decimal.js'
import { MsgSendToEth } from '@injectivelabs/sdk-ts'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { accounts } from '../accounts/index.js'
import { createBroadcaster } from '../client/index.js'
import { toBaseUnits } from '../utils/denom-math.js'
import {
  BroadcastFailed,
  InsufficientBalance,
  InvalidTransferAmount,
  UnknownDecimals,
  InvalidBridgeDenom,
} from '../errors/index.js'

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface PeggyWithdrawParams {
  address: string
  password: string
  /** Ethereum 0x... recipient address */
  ethRecipient: string
  denom: string
  /** Human-readable amount to withdraw */
  amount: string
  /** Bridge fee in same denom (human-readable). If omitted, uses minimum. */
  bridgeFee?: string
}

export interface PeggyWithdrawResult {
  txHash: string
  from: string
  ethRecipient: string
  denom: string
  amount: string
  bridgeFee: string
  estimatedArrival: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Default bridge fee when none specified.
 * For INJ: 0.001 INJ (18 decimals → "1000000000000000")
 * For USDT: 1 USDT (6 decimals → "1000000")
 * These are conservative minimums — actual fees depend on Ethereum gas prices.
 */
const DEFAULT_BRIDGE_FEES: Record<string, string> = {
  'inj': '0.001',
  'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7': '1',
  'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5': '1',
}

const DEFAULT_BRIDGE_FEE_FALLBACK = '0.001'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validate that a denom is bridgeable via Peggy.
 * Only INJ and peggy-prefixed tokens (which originated from Ethereum) can be withdrawn.
 */
function validatePeggyDenom(denom: string): void {
  if (denom !== 'inj' && !denom.startsWith('peggy')) {
    throw new InvalidBridgeDenom(denom)
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const bridges = {
  /**
   * Withdraw tokens from Injective to an Ethereum address via the Peggy bridge.
   *
   * Processing takes approximately 30 minutes. The transaction cannot be reversed
   * once submitted to the chain.
   */
  async withdrawToEth(config: Config, params: PeggyWithdrawParams): Promise<PeggyWithdrawResult> {
    const { address, password, ethRecipient, denom, amount: amountStr, bridgeFee: bridgeFeeStr } = params

    // 1. Validate denom is Peggy-bridgeable
    validatePeggyDenom(denom)

    // 2. Parse and validate amount
    const amount = new Decimal(amountStr)
    if (amount.lte(0)) {
      throw new InvalidTransferAmount('Amount must be greater than zero')
    }

    // 3. Resolve denom metadata
    const meta = await accounts.getDenomMetadata(config, denom)
    if (meta.decimals === null) {
      throw new UnknownDecimals(denom)
    }

    // 4. Determine bridge fee
    const feeHuman = bridgeFeeStr ?? DEFAULT_BRIDGE_FEES[denom] ?? DEFAULT_BRIDGE_FEE_FALLBACK
    const fee = new Decimal(feeHuman)
    if (fee.lt(0)) {
      throw new InvalidTransferAmount('Bridge fee cannot be negative')
    }
    // Note: Zero fee is allowed — the chain may accept or reject it.
    // A zero fee will likely cause very slow bridge processing.

    // 5. Total needed = amount + fee (both in same denom)
    const totalNeeded = amount.plus(fee)

    // 6. Convert to chain units
    const chainAmount = toBaseUnits(amount, meta.decimals)
    const chainFee = toBaseUnits(fee, meta.decimals)

    // 7. Best-effort balance check
    const balances = await accounts.getBalances(config, address)
    const bankBal = balances.bank.find(b => b.denom === denom)
    if (bankBal) {
      const available = new Decimal(bankBal.amount)
      if (available.lt(totalNeeded)) {
        throw new InsufficientBalance(
          `${totalNeeded.toFixed(6)} (${amountStr} + ${feeHuman} fee)`,
          bankBal.amount,
        )
      }
    }

    // 8. Decrypt key
    const privateKeyHex = wallets.unlock(address, password)

    // 9. Build MsgSendToEth
    const msg = MsgSendToEth.fromJSON({
      injectiveAddress: address,
      address: ethRecipient,
      amount: { denom, amount: chainAmount },
      bridgeFee: { denom, amount: chainFee },
    })

    // 10. Broadcast
    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({
        msgs: [msg],
        memo: `peggy withdraw ${amountStr} ${meta.symbol} to ${ethRecipient}`,
      })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return {
      txHash,
      from: address,
      ethRecipient,
      denom,
      amount: amountStr,
      bridgeFee: feeHuman,
      estimatedArrival: '~30 minutes',
    }
  },
}

export { debridge } from './debridge.js'
export type {
  DeBridgeQuoteParams,
  DeBridgeQuoteResult,
  DeBridgeSendParams,
  DeBridgeSendResult,
} from './debridge.js'
