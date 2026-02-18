/**
 * Transfers module — on-chain token transfers and subaccount operations.
 *
 * Covers:
 * - Bank-level token sends (MsgSend: any denom to any inj1... address)
 * - Subaccount deposits (MsgDeposit: bank → subaccount for trading margin)
 * - Subaccount withdrawals (MsgWithdraw: subaccount → bank)
 *
 * Security: Private keys are decrypted, used to sign, then discarded.
 * The LLM/agent never sees the private key — only txHash is returned.
 */
import Decimal from 'decimal.js'
import { MsgSend, MsgDeposit, MsgWithdraw, PrivateKey } from '@injectivelabs/sdk-ts'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { accounts } from '../accounts/index.js'
import { createBroadcaster } from '../client/index.js'
import {
  BroadcastFailed,
  InsufficientBalance,
  InvalidTransferAmount,
  SelfTransferBlocked,
  UnknownDecimals,
} from '../errors/index.js'

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface SendParams {
  address: string
  password: string
  recipient: string
  denom: string
  /** Human-readable amount, e.g. "1.5" for 1.5 INJ */
  amount: string
}

export interface SendResult {
  txHash: string
  from: string
  to: string
  denom: string
  amount: string
}

export interface SubaccountDepositParams {
  address: string
  password: string
  denom: string
  /** Human-readable amount to deposit */
  amount: string
  /** Subaccount index (0-255). Default: 0 */
  subaccountIndex?: number
}

export interface SubaccountDepositResult {
  txHash: string
  address: string
  subaccountId: string
  denom: string
  amount: string
}

export interface SubaccountWithdrawParams {
  address: string
  password: string
  denom: string
  /** Human-readable amount to withdraw */
  amount: string
  /** Subaccount index (0-255). Default: 0 */
  subaccountIndex?: number
}

export interface SubaccountWithdrawResult {
  txHash: string
  address: string
  subaccountId: string
  denom: string
  amount: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a human-readable amount to chain base units.
 * e.g. "1.5" with 18 decimals → "1500000000000000000"
 */
function toBaseUnits(humanAmount: Decimal, decimals: number): string {
  return humanAmount.mul(new Decimal(10).pow(decimals)).toFixed(0)
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const transfers = {
  /**
   * Send tokens (any bank denom) to another Injective address.
   */
  async send(config: Config, params: SendParams): Promise<SendResult> {
    const { address, password, recipient, denom, amount: amountStr } = params

    // 1. Validate sender ≠ recipient (footgun guard)
    if (address === recipient) {
      throw new SelfTransferBlocked()
    }

    // 2. Parse and validate amount
    const amount = new Decimal(amountStr)
    if (amount.lte(0)) {
      throw new InvalidTransferAmount('Amount must be greater than zero')
    }

    // 3. Resolve denom metadata to get decimals
    const meta = await accounts.getDenomMetadata(config, denom)
    if (meta.decimals === null) {
      throw new UnknownDecimals(denom)
    }

    // 4. Convert to chain units
    const chainAmount = toBaseUnits(amount, meta.decimals)

    // 5. Best-effort balance check (TOCTOU: balance can change between check and broadcast)
    const balances = await accounts.getBalances(config, address)
    const bankBal = balances.bank.find(b => b.denom === denom)
    if (bankBal && meta.decimals !== null) {
      const available = new Decimal(bankBal.amount)
      if (available.lt(amount)) {
        throw new InsufficientBalance(amountStr, bankBal.amount)
      }
    }

    // 6. Decrypt key
    const privateKeyHex = wallets.unlock(address, password)

    // 7. Build MsgSend
    const msg = MsgSend.fromJSON({
      srcInjectiveAddress: address,
      dstInjectiveAddress: recipient,
      amount: { denom, amount: chainAmount },
    })

    // 8. Broadcast
    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({
        msgs: [msg],
        memo: `send ${amountStr} ${meta.symbol} to ${recipient}`,
      })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return { txHash, from: address, to: recipient, denom, amount: amountStr }
  },

  /**
   * Deposit tokens from bank balance into a trading subaccount.
   */
  async deposit(config: Config, params: SubaccountDepositParams): Promise<SubaccountDepositResult> {
    const { address, password, denom, amount: amountStr, subaccountIndex = 0 } = params

    // 1. Parse and validate amount
    const amount = new Decimal(amountStr)
    if (amount.lte(0)) {
      throw new InvalidTransferAmount('Amount must be greater than zero')
    }

    // 2. Resolve denom metadata
    const meta = await accounts.getDenomMetadata(config, denom)
    if (meta.decimals === null) {
      throw new UnknownDecimals(denom)
    }

    // 3. Convert to chain units
    const chainAmount = toBaseUnits(amount, meta.decimals)

    // 4. Decrypt key and derive subaccount ID
    const privateKeyHex = wallets.unlock(address, password)
    const pk = PrivateKey.fromHex(privateKeyHex)
    const subaccountId = pk.toAddress().getSubaccountId(subaccountIndex)

    // 5. Build MsgDeposit
    const msg = MsgDeposit.fromJSON({
      injectiveAddress: address,
      subaccountId,
      amount: { denom, amount: chainAmount },
    })

    // 6. Broadcast
    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({
        msgs: [msg],
        memo: `deposit ${amountStr} ${meta.symbol} to subaccount ${subaccountIndex}`,
      })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return { txHash, address, subaccountId, denom, amount: amountStr }
  },

  /**
   * Withdraw tokens from a trading subaccount back to bank balance.
   */
  async withdraw(config: Config, params: SubaccountWithdrawParams): Promise<SubaccountWithdrawResult> {
    const { address, password, denom, amount: amountStr, subaccountIndex = 0 } = params

    // 1. Parse and validate amount
    const amount = new Decimal(amountStr)
    if (amount.lte(0)) {
      throw new InvalidTransferAmount('Amount must be greater than zero')
    }

    // 2. Resolve denom metadata
    const meta = await accounts.getDenomMetadata(config, denom)
    if (meta.decimals === null) {
      throw new UnknownDecimals(denom)
    }

    // 3. Convert to chain units
    const chainAmount = toBaseUnits(amount, meta.decimals)

    // 4. Decrypt key and derive subaccount ID
    const privateKeyHex = wallets.unlock(address, password)
    const pk = PrivateKey.fromHex(privateKeyHex)
    const subaccountId = pk.toAddress().getSubaccountId(subaccountIndex)

    // 5. Build MsgWithdraw
    const msg = MsgWithdraw.fromJSON({
      injectiveAddress: address,
      subaccountId,
      amount: { denom, amount: chainAmount },
    })

    // 6. Broadcast
    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({
        msgs: [msg],
        memo: `withdraw ${amountStr} ${meta.symbol} from subaccount ${subaccountIndex}`,
      })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return { txHash, address, subaccountId, denom, amount: amountStr }
  },
}
