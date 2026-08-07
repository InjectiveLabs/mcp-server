/**
 * Transaction decoder for Injective and Cosmos transactions.
 * Decodes tx hashes and raw transaction data, similar to the tx-checker page.
 */

import { StargateClient } from '@cosmjs/stargate'
import { decodeTxRaw } from '@cosmjs/proto-signing'
import type { Config } from '../config/index.js'

/**
 * Decode a protobuf message to JSON.
 * Attempts to parse base64-encoded protobuf data.
 */
function decodeProtobufMessage(base64Data: string): any {
  try {
    // Decode base64 to bytes
    const bytes = Buffer.from(base64Data, 'base64')

    // Try to parse as UTF-8 first (for JSON-encoded messages)
    try {
      const utf8Str = bytes.toString('utf-8')
      const printableCount = (utf8Str.match(/[\x20-\x7E]/g) || []).length
      if (printableCount / utf8Str.length > 0.5) {
        // Try to parse as JSON
        try {
          return JSON.parse(utf8Str)
        } catch {
          // Not JSON, return raw UTF-8
          return utf8Str
        }
      }
    } catch {
      // Not valid UTF-8
    }

    // For binary protobuf, return hex representation for inspection
    return {
      _type: 'protobuf_binary',
      _hex: bytes.toString('hex'),
      _base64: base64Data,
      _note: 'Binary protobuf data - use hex or base64 for inspection'
    }
  } catch (error) {
    return {
      _error: `Failed to decode protobuf: ${error instanceof Error ? error.message : 'Unknown error'}`,
      _data: base64Data
    }
  }
}

/**
 * Recursively decode base64 strings in an object.
 * Attempts to decode base64 values and returns decoded UTF-8 or original if invalid.
 */
function decodeNestedBase64(obj: any, key?: string): any {
  if (obj instanceof Uint8Array) {
    // Convert Uint8Array to base64 string first
    const base64Str = Buffer.from(obj).toString('base64')
    // Try to decode as UTF-8 - be very lenient
    try {
      const decoded = Buffer.from(obj).toString('utf-8')
      // Return decoded if it has any printable characters at all
      const printableCount = (decoded.match(/[\x20-\x7E]/g) || []).length
      if (printableCount > 0) {
        return decoded
      }
    } catch {
      // Not valid UTF-8, return base64 string
    }
    return base64Str
  } else if (typeof obj === 'string') {
    // Try to decode if it looks like base64 (alphanumeric with +/ and optional padding)
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(obj) && obj.length > 4) {
      try {
        const bytes = Buffer.from(obj, 'base64')
        const decoded = bytes.toString('utf-8')
        // Return decoded if it has any printable characters
        const printableCount = (decoded.match(/[\x20-\x7E]/g) || []).length
        if (printableCount > 0) {
          return decoded
        }
      } catch {
        // Not valid base64, return original
      }
    }
    return obj
  } else if (Array.isArray(obj)) {
    return obj.map((item) => decodeNestedBase64(item, key))
  } else if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const k in obj) {
      result[k] = decodeNestedBase64(obj[k], k)
    }
    return result
  }
  return obj
}

export interface DecodeTxParams {
  txHash: string
  rpcUrl?: string
}

export interface DecodeTxResult {
  txHash: string
  decoded: Record<string, unknown>
  messages: Array<{
    type: string
    value: Record<string, unknown>
  }>
  summary: string
}

export interface DecodeRawTxParams {
  txBytes: string // base64 or hex encoded
}

export interface DecodeRawTxResult {
  decoded: Record<string, unknown>
  messages: Array<{
    type: string
    value: Record<string, unknown>
  }>
  summary: string
}

/**
 * Decode a transaction by its hash from the blockchain.
 * Fetches the transaction from the RPC endpoint and decodes it.
 */
export async function decodeTxByHash(
  config: Config,
  params: DecodeTxParams,
): Promise<DecodeTxResult> {
  const { txHash, rpcUrl } = params

  if (!txHash || !txHash.trim()) {
    throw new Error('Transaction hash is required')
  }

  const normalizedHash = txHash.trim().toUpperCase()

  // Derive RPC from REST if not provided
  let rpc = rpcUrl
  if (!rpc) {
    const rest = config.endpoints.rest
    // Injective pattern: convert REST URL to RPC URL
    // e.g., https://injective-testnet-rest.publicnode.com -> https://injective-testnet-rpc.publicnode.com
    rpc = rest.replace('-rest.', '-rpc.')
  }

  if (!rpc) {
    throw new Error('No RPC endpoint configured')
  }

  try {
    const client = await StargateClient.connect(rpc)
    const txResponse = await client.getTx(normalizedHash)

    if (!txResponse) {
      throw new Error(`Transaction ${normalizedHash} not found on chain`)
    }

    // Decode the transaction
    const decoded = decodeTxRaw(txResponse.tx)

    // Apply base64 decoding to nested values
    const decodedWithBase64 = decodeNestedBase64(decoded)

    const messages = extractMessages(decodedWithBase64)
    const summary = generateSummary(messages)

    return {
      txHash: normalizedHash,
      decoded: JSON.parse(JSON.stringify(decodedWithBase64, (k, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
        return v
      })),
      messages,
      summary,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to decode transaction: ${error.message}`)
    }
    throw error
  }
}

/**
 * Decode raw transaction bytes (base64 or hex encoded).
 */
export async function decodeRawTx(params: DecodeRawTxParams): Promise<DecodeRawTxResult> {
  const { txBytes } = params

  if (!txBytes || !txBytes.trim()) {
    throw new Error('Transaction bytes are required')
  }

  try {
    let bytes: Uint8Array

    // Try to detect format: if it starts with 0x, treat as hex; otherwise base64
    const trimmed = txBytes.trim()
    if (trimmed.startsWith('0x')) {
      // Hex format
      const hexStr = trimmed.slice(2)
      bytes = new Uint8Array(Buffer.from(hexStr, 'hex'))
    } else {
      // Base64 format
      bytes = new Uint8Array(Buffer.from(trimmed, 'base64'))
    }

    const decoded = decodeTxRaw(bytes)

    // Apply base64 decoding to nested values
    const decodedWithBase64 = decodeNestedBase64(decoded)

    const messages = extractMessages(decodedWithBase64)
    const summary = generateSummary(messages)

    return {
      decoded: JSON.parse(JSON.stringify(decodedWithBase64, (k, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
        return v
      })),
      messages,
      summary,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to decode raw transaction: ${error.message}`)
    }
    throw error
  }
}

/**
 * Extract and interpret messages from a decoded transaction.
 */
function extractMessages(
  decoded: any,
): Array<{ type: string; value: Record<string, unknown> }> {
  const messages: Array<{ type: string; value: Record<string, unknown> }> = []

  if (!decoded.body || !decoded.body.messages) {
    return messages
  }

  for (const msg of decoded.body.messages) {
    const typeUrl = msg.typeUrl || ''
    let value = msg.value || {}

    // Parse the type URL to get a human-readable type
    const type = typeUrl.split('/').pop() || typeUrl

    // If value is a string (base64-encoded protobuf), try to decode it
    if (typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      const decodedValue = decodeProtobufMessage(value)
      value = decodedValue
    }

    // For CosmWasm messages, try to decode the msg field
    if (type === 'MsgExecuteContract' && typeof value === 'object' && value !== null) {
      if (value.msg instanceof Uint8Array) {
        const msgBase64 = Buffer.from(value.msg).toString('base64')
        const decodedMsg = decodeProtobufMessage(msgBase64)
        value = {
          ...value,
          msg: decodedMsg
        }
      } else if (typeof value.msg === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value.msg)) {
        // msg is already a base64 string
        const decodedMsg = decodeProtobufMessage(value.msg)
        value = {
          ...value,
          msg: decodedMsg
        }
      }
    }

    // Serialize value, handling special cases
    const serializedValue = JSON.parse(JSON.stringify(value, (k, v) => {
      if (typeof v === 'bigint') return v.toString()
      if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
      return v
    }))

    messages.push({
      type,
      value: serializedValue,
    })
  }

  return messages
}

/**
 * Generate a human-readable summary of the transaction.
 */
function generateSummary(messages: Array<{ type: string; value: Record<string, unknown> }>): string {
  if (messages.length === 0) {
    return 'Empty transaction'
  }

  const types = messages.map((m) => m.type).join(', ')
  return `Transaction with ${messages.length} message(s): ${types}`
}
