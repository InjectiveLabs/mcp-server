/**
 * Payment gate — middleware that wraps MCP tool handlers with fee-gating.
 *
 * Inspired by the x402 protocol (HTTP 402 "Payment Required"), this module
 * enables the MCP server to charge micropayments before executing tools.
 * Configuration is loaded from environment variables and the gate is
 * completely opt-in — disabled by default.
 */
import type { Config } from '../config/index.js'
import type { PaymentGateConfig, FeeConfig } from './types.js'
import { generateChallenge, storeChallenge, retrieveChallenge, cleanupExpired } from './challenge.js'
import { verifyPayment } from './verify.js'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Tools that are free by default (read-only and payment management). */
const DEFAULT_FREE_TOOLS = [
  'wallet_generate',
  'wallet_import',
  'wallet_list',
  'wallet_remove',
  'market_list',
  'market_price',
  'account_balances',
  'account_positions',
  'token_metadata',
  'payment_config',
  'payment_verify',
]

// ─── Config Loader ──────────────────────────────────────────────────────────

/**
 * Load payment gate configuration from environment variables.
 *
 * Environment variables:
 * - PAYMENT_GATE_ENABLED      — "true" to enable (default: "false")
 * - PAYMENT_GATE_RECIPIENT    — inj1... address to receive fees (required if enabled)
 * - PAYMENT_GATE_DEFAULT_AMOUNT — default fee per call (default: "0.001")
 * - PAYMENT_GATE_DEFAULT_DENOM  — fee token denom (default: "inj")
 * - PAYMENT_GATE_FREE_TOOLS    — comma-separated tool names always free
 */
export function loadPaymentGateConfig(): PaymentGateConfig {
  const enabled = process.env['PAYMENT_GATE_ENABLED'] === 'true'
  const recipient = process.env['PAYMENT_GATE_RECIPIENT'] ?? ''
  const defaultAmount = process.env['PAYMENT_GATE_DEFAULT_AMOUNT'] ?? '0.001'
  const defaultDenom = process.env['PAYMENT_GATE_DEFAULT_DENOM'] ?? 'inj'
  const freeToolsEnv = process.env['PAYMENT_GATE_FREE_TOOLS']

  const freeTools = freeToolsEnv
    ? freeToolsEnv.split(',').map((t) => t.trim()).filter(Boolean)
    : [...DEFAULT_FREE_TOOLS]

  const defaultFee: FeeConfig | undefined =
    enabled && recipient
      ? { amount: defaultAmount, denom: defaultDenom, recipientAddress: recipient }
      : undefined

  return {
    enabled,
    defaultFee,
    toolFees: {},
    freeTools,
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Wrap an MCP tool handler with payment gate logic.
 *
 * Flow:
 * 1. If no _paymentProof in params → issue PAYMENT_REQUIRED challenge
 * 2. If _paymentProof present → verify on-chain, then execute original handler
 */
export function createPaymentGatedHandler(
  toolName: string,
  feeConfig: FeeConfig,
  config: Config,
  originalHandler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>,
) {
  return async (params: Record<string, unknown>) => {
    // Periodic cleanup of expired challenges
    cleanupExpired()

    const proof = params?.['_paymentProof'] as
      | { paymentId?: string; txHash?: string }
      | undefined

    // ── No proof → issue challenge ──────────────────────────────────────
    if (!proof || !proof.paymentId || !proof.txHash) {
      const challenge = generateChallenge(toolName, feeConfig, config.network)
      storeChallenge(challenge)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'PAYMENT_REQUIRED',
                message: `Tool "${toolName}" requires a payment of ${feeConfig.amount} ${feeConfig.denom} before execution.`,
                challenge: {
                  paymentId: challenge.paymentId,
                  recipientAddress: challenge.recipientAddress,
                  amount: challenge.amount,
                  denom: challenge.denom,
                  expiresAt: challenge.expiresAt,
                  toolName: challenge.toolName,
                },
                instructions: [
                  `1. Send ${feeConfig.amount} ${feeConfig.denom} to ${feeConfig.recipientAddress}`,
                  `2. Re-call this tool with _paymentProof: { paymentId: "${challenge.paymentId}", txHash: "<your_tx_hash>" }`,
                  `3. The challenge expires at ${new Date(challenge.expiresAt).toISOString()}`,
                ],
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    // ── Proof provided → verify payment ─────────────────────────────────
    const challenge = retrieveChallenge(proof.paymentId)
    if (!challenge) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'PAYMENT_FAILED',
                reason: 'Invalid or expired payment ID. Request a new challenge by calling the tool without _paymentProof.',
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    const result = await verifyPayment(config, { paymentId: proof.paymentId, txHash: proof.txHash }, challenge)

    if (!result.verified) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'PAYMENT_FAILED',
                reason: result.reason,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    // ── Payment verified — execute the original handler ─────────────────
    const { _paymentProof: _, ...cleanParams } = params
    return originalHandler(cleanParams)
  }
}