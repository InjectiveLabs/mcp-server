/**
 * EVM module — generic transaction and encoding helpers for Injective inEVM.
 *
 * This module is bridge-agnostic and can be reused by deBridge, LayerZero, or
 * any future EVM contract interactions.
 */
import {
  getEthereumAddress,
  getInjectiveAddress,
} from '@injectivelabs/sdk-ts'
import { Interface, Wallet, getBytes, isAddress } from 'ethers'
import { Config } from '../config/index.js'
import { createClient } from '../client/index.js'
import { EvmTxFailed } from '../errors/index.js'
import { Any } from '@injectivelabs/core-proto-ts-v2/generated/google/protobuf/any_pb'
import { MsgEthereumTx, ExtensionOptionsEthereumTx } from '@injectivelabs/core-proto-ts-v2/generated/injective/evm/v1/tx_pb'
import { AuthInfo, Fee, TxBody, TxRaw } from '@injectivelabs/core-proto-ts-v2/generated/cosmos/tx/v1beta1/tx_pb'
import { Coin } from '@injectivelabs/core-proto-ts-v2/generated/cosmos/base/v1beta1/coin_pb'

const EVM_MSG_TYPE_URL = '/injective.evm.v1.MsgEthereumTx'
const EVM_EXTENSION_TYPE_URL = '/injective.evm.v1.ExtensionOptionsEthereumTx'
const DEFAULT_GAS_LIMIT = 300_000n

const ERC20_IFACE = new Interface([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
])

export interface EvmAccount {
  balance: string
  nonce: string
  codeHash: string
}

export interface BroadcastEvmTxParams {
  privateKeyHex: string
  to?: string
  data?: string
  value?: string
  nonce?: number
  gasPrice?: string
  gasLimit?: string | number | bigint
  chainId?: number
  memo?: string
  txTimeout?: number
}

export interface BroadcastEvmTxResult {
  txHash: string
  from: string
  to?: string
  nonce: number
  gasPrice: string
  gasLimit: string
  value: string
  chainId: number
  data: string
}

function parseBigInt(
  value: string | number | bigint,
  field: string,
  opts?: { min?: bigint },
): bigint {
  let parsed: bigint
  try {
    if (typeof value === 'bigint') {
      parsed = value
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`Invalid ${field}: expected an integer`)
      }
      parsed = BigInt(value)
    } else {
      parsed = BigInt(value)
    }
  } catch {
    throw new EvmTxFailed(`Invalid ${field}: ${String(value)}`)
  }

  const min = opts?.min ?? 0n
  if (parsed < min) {
    throw new EvmTxFailed(`Invalid ${field}: must be >= ${min.toString()}`)
  }

  return parsed
}

function normalizePrivateKey(privateKeyHex: string): string {
  return privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`
}

function normalizeHexData(data?: string): string {
  if (!data || data === '0x') return '0x'
  return data.startsWith('0x') ? data : `0x${data}`
}

function toSafeNonce(nonce: string): number {
  const parsed = Number(nonce)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new EvmTxFailed(`Invalid nonce from chain: ${nonce}`)
  }
  return parsed
}

/**
 * Build the Cosmos TxRaw wrapper for an RLP-encoded signed EVM transaction.
 *
 * The Ethermint ante handler (`EthGasConsumeDecorator`) reads gas from the
 * embedded EVM tx, but the Cosmos SDK transaction infrastructure requires
 * a well-formed AuthInfo.Fee.  The canonical `MsgEthereumTx.BuildTx()` in
 * Ethermint's Go code always sets:
 *   - Fee.amount  = [Coin("inj", gasPrice * gasLimit)]
 *   - Fee.gasLimit = gasLimit from the EVM tx
 *   - signerInfos  = []          (EVM sig lives inside MsgEthereumTx.raw)
 *   - signatures   = []          (same reason)
 */
function buildEvmTxRaw(
  rawEvmTx: Uint8Array,
  memo: string,
  gasPrice: bigint,
  gasLimit: bigint,
): TxRaw {
  const msg = MsgEthereumTx.create({ raw: rawEvmTx })
  const msgAny = Any.create({
    typeUrl: EVM_MSG_TYPE_URL,
    value: MsgEthereumTx.toBinary(msg),
  })

  const extension = ExtensionOptionsEthereumTx.create({})
  const extensionAny = Any.create({
    typeUrl: EVM_EXTENSION_TYPE_URL,
    value: ExtensionOptionsEthereumTx.toBinary(extension),
  })

  const body = TxBody.create({
    messages: [msgAny],
    memo,
    extensionOptions: [extensionAny],
    nonCriticalExtensionOptions: [],
  })

  const feeAmount = (gasPrice * gasLimit).toString()
  const fee = Fee.create({
    gasLimit,
    amount: [Coin.create({ denom: 'inj', amount: feeAmount })],
    payer: '',
    granter: '',
  })
  const authInfo = AuthInfo.create({ signerInfos: [], fee })

  return TxRaw.create({
    bodyBytes: TxBody.toBinary(body),
    authInfoBytes: AuthInfo.toBinary(authInfo),
    signatures: [],
  })
}

export async function getEvmAccount(config: Config, ethAddress: string): Promise<EvmAccount> {
  if (!isAddress(ethAddress)) {
    throw new EvmTxFailed(`Invalid Ethereum address: ${ethAddress}`)
  }

  const client = createClient(config)
  const account = await client.evmApi.fetchAccount(ethAddress)
  return {
    balance: account.balance,
    nonce: account.nonce,
    codeHash: account.codeHash,
  }
}

export async function getBaseFee(config: Config): Promise<string> {
  const client = createClient(config)
  return client.evmApi.fetchBaseFee()
}

export async function broadcastEvmTx(
  config: Config,
  params: BroadcastEvmTxParams,
): Promise<BroadcastEvmTxResult> {
  const client = createClient(config)
  const memo = params.memo ?? ''

  try {
    if (params.to && !isAddress(params.to)) {
      throw new EvmTxFailed(`Invalid destination address: ${params.to}`)
    }

    const wallet = new Wallet(normalizePrivateKey(params.privateKeyHex))
    const chainId = params.chainId ?? config.ethereumChainId
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new EvmTxFailed(`Invalid EVM chain ID: ${chainId}`)
    }

    const nonce = params.nonce ?? toSafeNonce((await getEvmAccount(config, wallet.address)).nonce)
    const gasPriceRaw = params.gasPrice ?? await getBaseFee(config)
    const gasPrice = parseBigInt(gasPriceRaw, 'gasPrice', { min: 0n })
    const gasLimit = parseBigInt(params.gasLimit ?? DEFAULT_GAS_LIMIT, 'gasLimit', { min: 1n })
    const value = parseBigInt(params.value ?? '0', 'value', { min: 0n })
    const data = normalizeHexData(params.data)

    const signedTxHex = await wallet.signTransaction({
      type: 0,
      to: params.to,
      data,
      value,
      nonce,
      gasPrice,
      gasLimit,
      chainId,
    })

    const txRaw = buildEvmTxRaw(getBytes(signedTxHex), memo, gasPrice, gasLimit)
    const response = await client.txApi.broadcast(txRaw, {
      txTimeout: params.txTimeout,
    })

    if (!response.txHash) {
      throw new EvmTxFailed('Transaction hash missing from broadcast response')
    }

    return {
      txHash: response.txHash,
      from: wallet.address,
      to: params.to,
      nonce,
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      value: value.toString(),
      chainId,
      data,
    }
  } catch (err: unknown) {
    if (err instanceof EvmTxFailed) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new EvmTxFailed(message)
  }
}

export function encodeErc20Transfer(to: string, amount: string | bigint | number): string {
  if (!isAddress(to)) {
    throw new EvmTxFailed(`Invalid ERC20 transfer recipient: ${to}`)
  }
  return ERC20_IFACE.encodeFunctionData('transfer', [to, parseBigInt(amount, 'amount', { min: 0n })])
}

export function encodeErc20Approve(spender: string, amount: string | bigint | number): string {
  if (!isAddress(spender)) {
    throw new EvmTxFailed(`Invalid ERC20 spender: ${spender}`)
  }
  return ERC20_IFACE.encodeFunctionData('approve', [spender, parseBigInt(amount, 'amount', { min: 0n })])
}

export function extractErc20Address(denom: string): string {
  if (!denom.startsWith('erc20:')) {
    throw new EvmTxFailed(`Not an ERC20 denom: ${denom}`)
  }

  const address = denom.slice('erc20:'.length)
  if (!isAddress(address)) {
    throw new EvmTxFailed(`Invalid ERC20 address in denom: ${denom}`)
  }

  return address
}

export function injAddressToEth(injAddress: string): string {
  return getEthereumAddress(injAddress)
}

export function ethAddressToInj(ethAddress: string): string {
  if (!isAddress(ethAddress)) {
    throw new EvmTxFailed(`Invalid Ethereum address: ${ethAddress}`)
  }
  return getInjectiveAddress(ethAddress)
}

export const evm = {
  broadcastEvmTx,
  getEvmAccount,
  getBaseFee,
  encodeErc20Transfer,
  encodeErc20Approve,
  extractErc20Address,
  injAddressToEth,
  ethAddressToInj,
}
