import type { Config } from '../config/index.js'
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

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    try {
      const privateKeyHex = wallets.unlock(params.address, params.password)
      const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
      const publicClient = createIdentityPublicClient(config.network)
      const { identityRegistry } = getIdentityConfig(config.network)

      const txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        account: walletClient.account!,
        address: identityRegistry,
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

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

      // Parse agentId from Transfer event (third indexed topic = tokenId)
      let agentId = '0'
      for (const log of receipt.logs) {
        if (log.topics.length >= 4 && log.topics[3]) {
          agentId = BigInt(log.topics[3]).toString()
          break
        }
      }

      const owner = walletClient.account!.address
      return { agentId, txHash, owner, evmAddress: owner }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(message)
    }
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    try {
      const privateKeyHex = wallets.unlock(params.address, params.password)
      const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
      const publicClient = createIdentityPublicClient(config.network)
      const { identityRegistry } = getIdentityConfig(config.network)
      const txHashes: string[] = []
      const tokenId = BigInt(params.agentId)

      // 1. Metadata update (name / type / builderCode)
      if (params.name !== undefined || params.type !== undefined || params.builderCode !== undefined) {
        // Read current metadata to merge unchanged fields
        const current = await publicClient.readContract({
          address: identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [tokenId],
        }) as [string, number, `0x${string}`]

        const newName = params.name ?? current[0]
        const newType = params.type ?? current[1]
        const newBuilderCode = (params.builderCode ?? current[2]) as `0x${string}`

        const txHash = await walletClient.writeContract({
          chain: walletClient.chain,
          account: walletClient.account!,
          address: identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'updateMetadata',
          args: [tokenId, newName, newType, newBuilderCode],
        })

        await publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      // 2. URI update
      if (params.uri !== undefined) {
        const txHash = await walletClient.writeContract({
          chain: walletClient.chain,
          account: walletClient.account!,
          address: identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setTokenURI',
          args: [tokenId, params.uri],
        })

        await publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      // 3. Wallet update
      if (params.wallet !== undefined) {
        const txHash = await walletClient.writeContract({
          chain: walletClient.chain,
          account: walletClient.account!,
          address: identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setLinkedWallet',
          args: [tokenId, params.wallet as `0x${string}`],
        })

        await publicClient.waitForTransactionReceipt({ hash: txHash })
        txHashes.push(txHash)
      }

      return { agentId: params.agentId, txHashes }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(message)
    }
  },

  async deregister(config: Config, params: DeregisterParams): Promise<DeregisterResult> {
    if (!params.confirm) {
      throw new DeregisterNotConfirmed()
    }

    try {
      const privateKeyHex = wallets.unlock(params.address, params.password)
      const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
      const publicClient = createIdentityPublicClient(config.network)
      const { identityRegistry } = getIdentityConfig(config.network)

      const txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        account: walletClient.account!,
        address: identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'deregister',
        args: [BigInt(params.agentId)],
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })

      return { agentId: params.agentId, txHash }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(message)
    }
  },
}
