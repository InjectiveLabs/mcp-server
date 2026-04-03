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
import { getIdentityConfig, type IdentityConfig } from './config.js'
import { IDENTITY_REGISTRY_ABI } from './abis.js'
import { encodeStringMetadata, walletLinkDeadline, signWalletLink, METADATA_KEYS } from './helpers.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

// ─── Parameter / result types ───────────────────────────────────────────────

export interface RegisterParams {
  address: string
  password: string
  name: string
  type: string
  builderCode: string
  wallet?: string
  uri?: string
}

export interface RegisterResult {
  agentId: string
  txHash: string
  owner: string
  evmAddress: string
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

export interface UpdateParams {
  address: string
  password: string
  agentId: string
  name?: string
  type?: string
  builderCode?: string
  uri?: string
  wallet?: string
}

export interface UpdateResult {
  agentId: string
  txHashes: string[]
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
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
  identityCfg: IdentityConfig
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
    const identityCfg = getIdentityConfig(config.network)
    const account = walletClient.account
    if (!account) throw new IdentityTxFailed('Wallet client has no account')

    return await fn({
      walletClient,
      publicClient,
      account,
      chain: walletClient.chain!,
      identityCfg,
    })
  } catch (err) {
    if (err instanceof IdentityTxFailed) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new IdentityTxFailed(message)
  }
}

interface WalletLinkResult {
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

async function linkWalletIfSelf(
  ctx: TxContext,
  agentId: bigint,
  wallet: string | undefined,
): Promise<WalletLinkResult> {
  if (!wallet) return {}

  if (wallet.toLowerCase() !== ctx.account.address.toLowerCase()) {
    return {
      walletLinkSkipped: true,
      walletLinkReason: 'Wallet differs from signer. Link manually with the wallet\'s private key.',
    }
  }

  const deadline = walletLinkDeadline()
  const signature = await signWalletLink({
    account: ctx.account,
    agentId,
    newWallet: wallet as `0x${string}`,
    ownerAddress: ctx.account.address,
    deadline,
    chainId: ctx.identityCfg.chainId,
    verifyingContract: ctx.identityCfg.identityRegistry,
  })

  const walletTxHash = await ctx.walletClient.writeContract({
    chain: ctx.chain,
    account: ctx.account,
    address: ctx.identityCfg.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setAgentWallet',
    args: [agentId, wallet as `0x${string}`, deadline, signature],
  })
  await ctx.publicClient.waitForTransactionReceipt({ hash: walletTxHash })

  return { walletTxHash }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const metadata = [
        { metadataKey: METADATA_KEYS.NAME, metadataValue: encodeStringMetadata(params.name) },
        { metadataKey: METADATA_KEYS.AGENT_TYPE, metadataValue: encodeStringMetadata(params.type) },
        { metadataKey: METADATA_KEYS.BUILDER_CODE, metadataValue: encodeStringMetadata(params.builderCode) },
      ]

      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityCfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [params.uri ?? '', metadata],
      })

      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Extract agentId from Registered event (topic[1] = indexed agentId)
      let agentId = '0'
      const registryAddr = ctx.identityCfg.identityRegistry.toLowerCase()
      for (const log of receipt.logs) {
        if (
          log.address?.toLowerCase() === registryAddr &&
          log.topics.length >= 2 &&
          log.topics[1]
        ) {
          agentId = BigInt(log.topics[1]).toString()
          break
        }
      }

      const walletResult = await linkWalletIfSelf(ctx, BigInt(agentId), params.wallet)

      return {
        agentId,
        txHash,
        owner: ctx.account.address,
        evmAddress: ctx.account.address,
        ...walletResult,
      }
    })
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    if ([params.name, params.type, params.builderCode, params.uri, params.wallet].every(v => v === undefined)) {
      throw new IdentityTxFailed('No fields provided to update')
    }

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const id = BigInt(params.agentId)
      const registry = ctx.identityCfg.identityRegistry

      // Phase 1: send all metadata + URI txs sequentially (nonce ordering)
      const pendingHashes: `0x${string}`[] = []

      for (const [key, value] of [
        [METADATA_KEYS.NAME, params.name],
        [METADATA_KEYS.AGENT_TYPE, params.type],
        [METADATA_KEYS.BUILDER_CODE, params.builderCode],
      ] as const) {
        if (value !== undefined) {
          const txHash = await ctx.walletClient.writeContract({
            chain: ctx.chain, account: ctx.account,
            address: registry, abi: IDENTITY_REGISTRY_ABI,
            functionName: 'setMetadata',
            args: [id, key, encodeStringMetadata(value)],
          })
          pendingHashes.push(txHash)
        }
      }

      if (params.uri !== undefined) {
        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain, account: ctx.account,
          address: registry, abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setAgentURI',
          args: [id, params.uri],
        })
        pendingHashes.push(txHash)
      }

      // Phase 2: wait for all receipts in parallel
      await Promise.all(pendingHashes.map(h => ctx.publicClient.waitForTransactionReceipt({ hash: h })))

      const walletResult = await linkWalletIfSelf(ctx, id, params.wallet)

      return {
        agentId: params.agentId,
        txHashes: pendingHashes,
        ...walletResult,
      }
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
        address: ctx.identityCfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'deregister',
        args: [BigInt(params.agentId)],
      })

      await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
      return { agentId: params.agentId, txHash }
    })
  },
}
