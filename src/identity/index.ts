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
import { encodeStringMetadata, walletLinkDeadline, signWalletLink } from './helpers.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

// ─── Parameter / result types ───────────────────────────────────────────────

export interface RegisterParams {
  address: string      // inj1... for keystore
  password: string
  name: string         // agent name (stored as metadata key "name")
  type: string         // agent type string, e.g. "trading" (stored as metadata key "agentType")
  builderCode: string  // builder identifier string (stored as metadata key "builderCode")
  wallet?: string      // 0x... EVM address to link (optional, self-link only)
  uri?: string         // token URI (e.g. IPFS link to agent card)
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
  name?: string         // update agent name via setMetadata
  type?: string         // agent type string
  builderCode?: string  // builder identifier string
  uri?: string
  wallet?: string       // self-link only
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
  identityRegistry: `0x${string}`
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
      identityRegistry: identityCfg.identityRegistry,
      identityCfg,
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
      // 1. Build metadata entries
      const metadata = [
        { metadataKey: 'name', metadataValue: encodeStringMetadata(params.name) },
        { metadataKey: 'agentType', metadataValue: encodeStringMetadata(params.type) },
        { metadataKey: 'builderCode', metadataValue: encodeStringMetadata(params.builderCode) },
      ]

      // 2. Call register(agentURI, metadata[]) overload
      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [params.uri ?? '', metadata],
      })

      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })

      // 3. Extract agentId from Registered event (topic[1] = indexed agentId)
      let agentId = '0'
      for (const log of receipt.logs) {
        if (log.topics.length >= 2 && log.topics[1]) {
          // Registered event: topics[0]=sig, topics[1]=agentId(indexed), topics[2]=owner(indexed)
          const registryAddr = ctx.identityRegistry.toLowerCase()
          if (log.address?.toLowerCase() === registryAddr) {
            agentId = BigInt(log.topics[1]).toString()
            break
          }
        }
      }

      const result: RegisterResult = {
        agentId,
        txHash,
        owner: ctx.account.address,
        evmAddress: ctx.account.address,
      }

      // 4. Optional wallet linking (self-link only)
      if (params.wallet) {
        if (params.wallet.toLowerCase() === ctx.account.address.toLowerCase()) {
          // Self-link: sign EIP-712 and call setAgentWallet
          const deadline = walletLinkDeadline()
          const signature = await signWalletLink({
            account: ctx.account,
            agentId: BigInt(agentId),
            newWallet: params.wallet as `0x${string}`,
            ownerAddress: ctx.account.address,
            deadline,
            chainId: ctx.identityCfg.chainId,
            verifyingContract: ctx.identityRegistry,
          })

          const walletTxHash = await ctx.walletClient.writeContract({
            chain: ctx.chain,
            account: ctx.account,
            address: ctx.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'setAgentWallet',
            args: [BigInt(agentId), params.wallet as `0x${string}`, deadline, signature],
          })
          await ctx.publicClient.waitForTransactionReceipt({ hash: walletTxHash })
          result.walletTxHash = walletTxHash
        } else {
          // Different wallet: skip with warning
          result.walletLinkSkipped = true
          result.walletLinkReason = 'Wallet differs from signer. Link manually with the wallet\'s private key.'
        }
      }

      return result
    })
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    // Validation: at least one field
    const hasName = params.name !== undefined
    const hasType = params.type !== undefined
    const hasBuilderCode = params.builderCode !== undefined
    const hasUri = params.uri !== undefined
    const hasWallet = params.wallet !== undefined
    if (!hasName && !hasType && !hasBuilderCode && !hasUri && !hasWallet) {
      throw new IdentityTxFailed('No fields provided to update')
    }

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const txHashes: string[] = []
      const id = BigInt(params.agentId)
      const result: UpdateResult = { agentId: params.agentId, txHashes }

      // Per-key metadata updates (NO merge needed — each key is independent)
      for (const [key, value] of [
        ['name', params.name],
        ['agentType', params.type],
        ['builderCode', params.builderCode],
      ] as const) {
        if (value !== undefined) {
          const txHash = await ctx.walletClient.writeContract({
            chain: ctx.chain,
            account: ctx.account,
            address: ctx.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'setMetadata',
            args: [id, key, encodeStringMetadata(value)],
          })
          await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
          txHashes.push(txHash)
        }
      }

      // URI update
      if (hasUri) {
        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain,
          account: ctx.account,
          address: ctx.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setAgentURI',
          args: [id, params.uri!],
        })
        await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      // Wallet link (same EIP-712 flow as register)
      if (hasWallet) {
        if (params.wallet!.toLowerCase() === ctx.account.address.toLowerCase()) {
          const deadline = walletLinkDeadline()
          const signature = await signWalletLink({
            account: ctx.account,
            agentId: id,
            newWallet: params.wallet as `0x${string}`,
            ownerAddress: ctx.account.address,
            deadline,
            chainId: ctx.identityCfg.chainId,
            verifyingContract: ctx.identityRegistry,
          })
          const txHash = await ctx.walletClient.writeContract({
            chain: ctx.chain,
            account: ctx.account,
            address: ctx.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'setAgentWallet',
            args: [id, params.wallet as `0x${string}`, deadline, signature],
          })
          await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
          result.walletTxHash = txHash
        } else {
          result.walletLinkSkipped = true
          result.walletLinkReason = 'Wallet differs from signer. Link manually with the wallet\'s private key.'
        }
      }

      return result
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
