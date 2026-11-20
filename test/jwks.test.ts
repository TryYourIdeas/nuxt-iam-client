import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJwk, resetJwksCacheForTests } from '../src/runtime/server/utils/jwks'

const URI = 'https://iam.example.com/.well-known/jwks.json'
const keyA = { kty: 'RSA', kid: 'a', alg: 'RS256', n: 'n-a', e: 'AQAB' }
const keyB = { kty: 'RSA', kid: 'b', alg: 'RS256', n: 'n-b', e: 'AQAB' }

function jwksResponse(keys: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ keys }) } as unknown as Response
}

describe('getJwk', () => {
  let now = 1_000_000
  const clock = () => now

  beforeEach(() => {
    resetJwksCacheForTests()
    now = 1_000_000
  })

  it('fetches the JWKS and returns the key with the requested kid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jwksResponse([keyA]))
    await expect(getJwk(URI, 'a', { fetch: fetchMock, now: clock })).resolves.toEqual(keyA)
    expect(fetchMock).toHaveBeenCalledWith(URI)
  })

  it('serves from cache for 600 seconds, then refetches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jwksResponse([keyA]))
    await getJwk(URI, 'a', { fetch: fetchMock, now: clock })
    now += 599_000
    await getJwk(URI, 'a', { fetch: fetchMock, now: clock })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    now += 2_000
    await getJwk(URI, 'a', { fetch: fetchMock, now: clock })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refetches once for an unknown kid and finds a key added by rotation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jwksResponse([keyA])).mockResolvedValueOnce(jwksResponse([keyA, keyB]))
    await getJwk(URI, 'a', { fetch: fetchMock, now: clock })
    await expect(getJwk(URI, 'b', { fetch: fetchMock, now: clock })).resolves.toEqual(keyB)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null for an unknown kid and refetches at most once per 30 seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jwksResponse([keyA]))
    await getJwk(URI, 'a', { fetch: fetchMock, now: clock })
    await expect(getJwk(URI, 'x', { fetch: fetchMock, now: clock })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    now += 10_000
    await expect(getJwk(URI, 'y', { fetch: fetchMock, now: clock })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    now += 21_000
    await getJwk(URI, 'z', { fetch: fetchMock, now: clock })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('returns null on a failed fetch without poisoning the cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jwksResponse([keyA]))
    await expect(getJwk(URI, 'a', { fetch: fetchMock, now: clock })).resolves.toBeNull()
    now += 31_000
    await expect(getJwk(URI, 'a', { fetch: fetchMock, now: clock })).resolves.toBeNull()
    now += 31_000
    await expect(getJwk(URI, 'a', { fetch: fetchMock, now: clock })).resolves.toEqual(keyA)
  })
})
