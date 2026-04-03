/**
 * Identity module — register, update, and deregister agent identities
 * on the ERC-8004 IdentityRegistry contract via Injective EVM.
 *
 * Security: Private keys are decrypted, used to sign EVM transactions,
 * then discarded. The LLM/agent never sees the private key.
 */
import type { Config } from '../config/index.js'
import type { PublicClient, WalletClient, Account, Chain } from 'viem'
import { wallets } from '../wallets/index.js'
import { createIdentityWalletClient, createIdentityPublicClient } from './client.js'
import { getIdentityConfig } from './config.js'
import { IDENTITY_REGISTRY_ABI } from './abis.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

// ─── Parameter / result types ───────────────────────────────────────────────

export interface RegisterParams {
  address: string
  password: string
  name: string
  type: number
  builderCode: string
  wallet: string
  uri?: string
}

export interface RegisterResult {
  agentId: string
  txHash: string
  owner: string
  evmAddress: string
}

export interface UpdateParams {
  address: string
  password: string
  agentId: string
  name?: string
  type?: number
  builderCode?: string
  uri?: string
  wallet?: string
}

export interface UpdateResult {
  agentId: string
  txHashes: string[]
}

export interface DeregisterParams {
  address: string
  password: string
  agentId: string
  confirm: boolean
}

export interface DeregisterResult {
  agentId: string
  txHash: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface TxContext {
  walletClient: WalletClient
  publicClient: PublicClient
  account: Account
  chain: Chain
  identityRegistry: `0x${string}`
}

async function withIdentityTx<T>(
  config: Config,
  address: string,
  password: string,
  fn: (ctx: TxContext) => Promise<T>,
): Promise<T> {
  try {
    const privateKeyHex = wallets.unlock(address, password)
    const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
    const publicClient = createIdentityPublicClient(config.network)
    const { identityRegistry } = getIdentityConfig(config.network)
    const account = walletClient.account
    if (!account) throw new IdentityTxFailed('Wallet client has no account')

    return await fn({
      walletClient,
      publicClient,
      account,
      chain: walletClient.chain!,
      identityRegistry,
    })
  } catch (err) {
    if (err instanceof IdentityTxFailed) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new IdentityTxFailed(message)
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'registerAgent',
        args: [
          params.name,
          params.type,
          params.builderCode as `0x${string}`,
          params.uri ?? '',
          params.wallet as `0x${string}`,
        ],
      })

      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Parse agentId from Transfer event (third indexed topic = tokenId).
      // Filter by contract address to avoid picking up events from other contracts.
      let agentId = '0'
      const registryAddr = ctx.identityRegistry.toLowerCase()
      for (const log of receipt.logs) {
        if (
          log.address?.toLowerCase() === registryAddr &&
          log.topics.length >= 4 &&
          log.topics[3]
        ) {
          agentId = BigInt(log.topics[3]).toString()
          break
        }
      }

      return { agentId, txHash, owner: ctx.account.address, evmAddress: ctx.account.address }
    })
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    const hasMetadata = params.name !== undefined || params.type !== undefined || params.builderCode !== undefined
    const hasUri = params.uri !== undefined
    const hasWallet = params.wallet !== undefined
    if (!hasMetadata && !hasUri && !hasWallet) {
      throw new IdentityTxFailed('No fields provided to update')
    }

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const txHashes: string[] = []
      const tokenId = BigInt(params.agentId)

      if (hasMetadata) {
        const current = await ctx.publicClient.readContract({
          address: ctx.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [tokenId],
        }) as [string, number, `0x${string}`]

        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain,
          account: ctx.account,
          address: ctx.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'updateMetadata',
          args: [
            tokenId,
            params.name ?? current[0],
            params.type ?? current[1],
            (params.builderCode ?? current[2]) as `0x${string}`,
          ],
        })
        await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      if (hasUri) {
        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain,
          account: ctx.account,
          address: ctx.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setTokenURI',
          args: [tokenId, params.uri!],
        })
        await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      if (hasWallet) {
        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain,
          account: ctx.account,
          address: ctx.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setLinkedWallet',
          args: [tokenId, params.wallet as `0x${string}`],
        })
        await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      return { agentId: params.agentId, txHashes }
    })
  },

  async deregister(config: Config, params: DeregisterParams): Promise<DeregisterResult> {
    if (!params.confirm) {
      throw new DeregisterNotConfirmed()
    }

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'deregister',
        args: [BigInt(params.agentId)],
      })

      await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
      return { agentId: params.agentId, txHash }
    })
  },
}
