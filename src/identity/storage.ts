export class StorageError extends Error {
  readonly code = 'STORAGE_ERROR'
  constructor(reason: string) {
    super(`IPFS storage error: ${reason}`)
    this.name = 'StorageError'
  }
}

const PINATA_PIN_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS'

export class PinataStorage {
  private jwt: string

  constructor(jwt: string) {
    this.jwt = jwt
  }

  async uploadJSON(data: unknown, name: string): Promise<string> {
    try {
      const response = await fetch(PINATA_PIN_JSON_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pinataContent: data,
          pinataMetadata: { name },
          pinataOptions: { cidVersion: 1 },
        }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new StorageError(`Pinata upload failed (HTTP ${response.status}): ${body.slice(0, 200)}`)
      }

      const result = (await response.json()) as { IpfsHash: string }
      return `ipfs://${result.IpfsHash}`
    } catch (err) {
      if (err instanceof StorageError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new StorageError(message)
    }
  }
}
