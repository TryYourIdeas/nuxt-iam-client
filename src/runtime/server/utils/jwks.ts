/** A public key as published in a JWKS (RFC 7517). */
export interface Jwk {
  kty: string
  kid?: string
  alg?: string
  use?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

export interface JwksDeps {
  fetch?: typeof fetch
  now?: () => number
}

const CACHE_TTL_MS = 600_000
const MIN_REFETCH_INTERVAL_MS = 30_000

interface CacheEntry {
  keys: Jwk[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
/** Last time an unknown kid or a failed fetch caused a request, per JWKS URI. */
const lastForcedFetchAt = new Map<string, number>()

async function fetchKeys(jwksUri: string, fetchFn: typeof fetch): Promise<Jwk[] | null> {
  try {
    const response = await fetchFn(jwksUri)
    if (!response.ok) return null
    const body = (await response.json()) as { keys?: unknown }
    return Array.isArray(body.keys) ? (body.keys as Jwk[]) : null
  } catch {
    return null
  }
}

/**
 * Returns the key with `kid` from the JWKS at `jwksUri`, or null.
 * Keys are cached for 10 minutes. An unknown kid (for example right after the issuer rotated its key)
 * or a failed fetch triggers at most one extra request per 30 seconds, so a flood of bogus tokens
 * cannot hammer the issuer. A failed fetch never replaces keys that worked.
 */
export async function getJwk(jwksUri: string, kid: string, deps: JwksDeps = {}): Promise<Jwk | null> {
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now

  const entry = cache.get(jwksUri)
  const fresh = entry !== undefined && now() - entry.fetchedAt < CACHE_TTL_MS
  if (fresh) {
    const key = entry.keys.find((candidate) => candidate.kid === kid)
    if (key) return key
  }

  const lastForced = lastForcedFetchAt.get(jwksUri)
  if (lastForced !== undefined && now() - lastForced < MIN_REFETCH_INTERVAL_MS) {
    return entry?.keys.find((candidate) => candidate.kid === kid) ?? null
  }

  const keys = await fetchKeys(jwksUri, fetchFn)
  if (keys) {
    cache.set(jwksUri, { keys, fetchedAt: now() })
    if (fresh) lastForcedFetchAt.set(jwksUri, now())
    return keys.find((candidate) => candidate.kid === kid) ?? null
  }

  lastForcedFetchAt.set(jwksUri, now())
  return entry?.keys.find((candidate) => candidate.kid === kid) ?? null
}

export function resetJwksCacheForTests(): void {
  cache.clear()
  lastForcedFetchAt.clear()
}
