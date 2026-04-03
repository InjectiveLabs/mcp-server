export interface ServiceEntry {
  type: 'a2a' | 'mcp' | 'rest' | 'grpc' | 'webhook' | 'custom'
  url: string
  description?: string
}

export interface AgentCardMetadata {
  chain: string
  chainId: string
  agentType: string
  builderCode: string
  operatorAddress: string
}

export interface AgentCard {
  type: string
  name: string
  description?: string
  image: string
  services: ServiceEntry[]
  x402Support: boolean
  metadata: AgentCardMetadata
}

export interface GenerateCardOptions {
  name: string
  agentType: string
  builderCode: string
  operatorAddress: string
  chainId: number
  description?: string
  image?: string
  services?: ServiceEntry[]
}

export interface CardUpdates {
  name?: string
  description?: string
  image?: string
  services?: ServiceEntry[]
  removeServices?: string[]
}
