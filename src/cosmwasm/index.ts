/**
 * CosmWasm module — query and execute CosmWasm smart contracts on Injective.
 *
 * Security: Private keys are decrypted, used to sign, then discarded.
 */
import { MsgExecuteContract } from '@injectivelabs/sdk-ts'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { createBroadcaster, withRetry } from '../client/index.js'
import { BroadcastFailed } from '../errors/index.js'

export interface QueryParams {
  contract: string
  query: Record<string, unknown>
}

export interface QueryResult {
  data: unknown
}

export interface ExecuteParams {
  address: string
  password: string
  contract: string
  msg: Record<string, unknown>
  funds?: { denom: string; amount: string }[]
}

export interface ExecuteResult {
  txHash: string
}

async function base64Encode(input: string): Promise<string> {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('base64')
  }
  if (typeof btoa !== 'undefined') {
    return btoa(input)
  }
  throw new Error('No base64 encoder available')
}

export const cosmwasm = {
  async query(config: Config, params: QueryParams): Promise<QueryResult> {
    const { contract, query } = params
    const queryJson = JSON.stringify(query)
    const queryBase64 = await base64Encode(queryJson)
    const url = `${config.endpoints.rest}/cosmwasm/wasm/v1/contract/${contract}/smart/${queryBase64}`

    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`CosmWasm query failed (${response.status}): ${text}`)
    }

    const result = (await response.json()) as { data?: unknown; error?: string }
    if (result.error) {
      throw new Error(`CosmWasm query error: ${result.error}`)
    }

    return { data: result.data }
  },

  async execute(config: Config, params: ExecuteParams): Promise<ExecuteResult> {
    const { address, password, contract, msg, funds = [] } = params

    const privateKeyHex = wallets.unlock(address, password)

    const message = MsgExecuteContract.fromJSON({
      contractAddress: contract,
      sender: address,
      msg,
      funds,
    })

    const broadcaster = createBroadcaster(config, privateKeyHex)

    const result = await withRetry<{ txHash: string }>(() =>
      broadcaster.broadcast({ msgs: [message] }) as Promise<{ txHash: string }>,
    )

    if (!result.txHash) {
      throw new BroadcastFailed('CosmWasm execute returned no txHash')
    }

    return { txHash: result.txHash }
  },
}
