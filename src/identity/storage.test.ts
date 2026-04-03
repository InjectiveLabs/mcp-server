import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { PinataStorage, StorageError } from './storage.js'

describe('PinataStorage', () => {
  const storage = new PinataStorage('test-jwt-token')

  beforeEach(() => vi.clearAllMocks())

  it('uploads JSON and returns ipfs:// URI', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ IpfsHash: 'bafkreitest123' }),
    })
    const uri = await storage.uploadJSON({ name: 'TestBot' }, 'test-card')
    expect(uri).toBe('ipfs://bafkreitest123')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-jwt-token',
        }),
      }),
    )
  })

  it('includes pinataContent, pinataMetadata, and cidVersion in body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ IpfsHash: 'bafkrei123' }),
    })
    await storage.uploadJSON({ foo: 'bar' }, 'my-pin')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.pinataContent).toEqual({ foo: 'bar' })
    expect(body.pinataMetadata.name).toBe('my-pin')
    expect(body.pinataOptions.cidVersion).toBe(1)
  })

  it('throws StorageError on HTTP failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })
    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow(StorageError)
    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow('401')
  })

  it('throws StorageError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow(StorageError)
    await expect(storage.uploadJSON({}, 'test')).rejects.toThrow('ECONNREFUSED')
  })

  it('truncates long error bodies to 200 chars', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'x'.repeat(500),
    })
    try {
      await storage.uploadJSON({}, 'test')
    } catch (err: any) {
      expect(err.message.length).toBeLessThan(300)
    }
  })
})
