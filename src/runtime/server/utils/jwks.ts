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
const FETCH_TIMEOUT_MS = 5_000

interface CacheEntry {
  keys: Jwk[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
/** Last time an unknown kid or a failed fetch caused a request, per JWKS URI. */
const lastForcedFetchAt = new Map<string, number>()
/** One in-flight fetch per JWKS URI, shared by every concurrent caller. */
const inflight = new Map<string, Promise<Jwk[] | null>>()

async function fetchKeys(jwksUri: string, fetchFn: typeof fetch): Promise<Jwk[] | null> {
  try {
    const response = await fetchFn(jwksUri, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) {
      console.warn(`[nuxt-iam-client] JWKS fetch failed for ${jwksUri}`, { status: response.status })
      return null
    }
    const body = (await response.json()) as { keys?: unknown }
    if (!Array.isArray(body.keys)) {
      console.warn(`[nuxt-iam-client] JWKS response from ${jwksUri} has no keys array`, {})
      return null
    }
    return body.keys as Jwk[]
  } catch (error) {
    console.warn(`[nuxt-iam-client] JWKS fetch failed for ${jwksUri}`, { error: (error as Error)?.message })
    return null
  }
}

function findKey(keys: Jwk[] | undefined, kid: string): Jwk | null {
  return keys?.find((candidate) => candidate.kid === kid) ?? null
}

/**
 * Returns the key with `kid` from the JWKS at `jwksUri`, or null.
 * Keys are cached for 10 minutes. Concurrent callers share one in-flight fetch. An unknown kid (for
 * example right after the issuer rotated its key) or a failed fetch triggers at most one extra request per
 * 30 seconds, so a flood of bogus tokens cannot hammer the issuer. Fetches time out after 5 seconds, and a
 * failed fetch never replaces keys that worked.
 */
export async function getJwk(jwksUri: string, kid: string, deps: JwksDeps = {}): Promise<Jwk | null> {
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now

  const entry = cache.get(jwksUri)
  const fresh = entry !== undefined && now() - entry.fetchedAt < CACHE_TTL_MS
  if (fresh) {
    const key = findKey(entry.keys, kid)
    if (key) return key
  }

  const pending = inflight.get(jwksUri)
  if (pending) {
    return findKey((await pending) ?? cache.get(jwksUri)?.keys, kid)
  }

  const lastForced = lastForcedFetchAt.get(jwksUri)
  if (lastForced !== undefined && now() - lastForced < MIN_REFETCH_INTERVAL_MS) {
    return findKey(entry?.keys, kid)
  }
  // A refetch forced by an unknown kid starts the 30 s window now, before awaiting, so concurrent misses
  // that arrive after this fetch completes are throttled too.
  if (fresh) lastForcedFetchAt.set(jwksUri, now())

  const request = fetchKeys(jwksUri, fetchFn)
    .then((keys) => {
      if (keys) {
        cache.set(jwksUri, { keys, fetchedAt: now() })
      } else {
        lastForcedFetchAt.set(jwksUri, now())
      }
      return keys
    })
    .finally(() => inflight.delete(jwksUri))
  inflight.set(jwksUri, request)

  return findKey((await request) ?? entry?.keys, kid)
}

export function resetJwksCacheForTests(): void {
  cache.clear()
  lastForcedFetchAt.clear()
  inflight.clear()
}
