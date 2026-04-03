import type { AgentCard, GenerateCardOptions, CardUpdates } from './types.js'

const AGENT_CARD_TYPE = 'https://erc8004.org/agent-card'

export function validateImageUrl(image: string): void {
  if (!image) return
  if (image.startsWith('https://') || image.startsWith('http://') || image.startsWith('ipfs://')) return
  throw new Error('Image must be a URL (https://, http://, or ipfs://). Local file paths are not supported in MCP.')
}

export function generateAgentCard(opts: GenerateCardOptions): AgentCard {
  if (opts.image) validateImageUrl(opts.image)

  const card: AgentCard = {
    type: AGENT_CARD_TYPE,
    name: opts.name,
    image: opts.image || '',
    services: opts.services ?? [],
    x402Support: false,
    metadata: {
      chain: 'injective',
      chainId: String(opts.chainId),
      agentType: opts.agentType,
      builderCode: opts.builderCode,
      operatorAddress: opts.operatorAddress,
    },
  }

  if (opts.description) {
    card.description = opts.description
  }

  return card
}

export async function fetchAgentCard(
  uri: string,
  ipfsGateway: string,
): Promise<AgentCard | null> {
  if (!uri) return null
  try {
    const url = uri.startsWith('ipfs://')
      ? `${ipfsGateway}${uri.slice('ipfs://'.length)}`
      : uri
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as AgentCard
  } catch {
    return null
  }
}

export function mergeAgentCard(existing: AgentCard, updates: CardUpdates): AgentCard {
  const merged = { ...existing }
  if (updates.name !== undefined) merged.name = updates.name
  if (updates.description !== undefined) merged.description = updates.description
  if (updates.image !== undefined) {
    validateImageUrl(updates.image)
    merged.image = updates.image
  }
  if (updates.services !== undefined) {
    merged.services = updates.services
  }
  if (updates.removeServices?.length) {
    merged.services = merged.services.filter(
      (s) => !updates.removeServices!.includes(s.type),
    )
  }
  return merged
}
