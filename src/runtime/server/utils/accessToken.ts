import { createPublicKey, createVerify, verify as verifyOneShot, type JsonWebKey, type KeyObject } from 'node:crypto'
import { getJwk, type Jwk } from './jwks'

/**
 * Verification of `iam` access tokens on API routes (RFC 9068 s4, RFC 8725 s3).
 * Decisions: web/docs/security/design-changes-proposal.md SEC-12.
 */
export interface VerifyAccessTokenOptions {
  /** The issuer identifier (`IAM_ISSUER` of the iam instance). A trailing slash is ignored. */
  issuer: string
  /** This application's own identifier(s) as they appear in `aud` (its resource URI and/or app id). */
  audience: string | string[]
  /** Defaults to `<issuer>/.well-known/jwks.json`. */
  jwksUri?: string
  /** Allowed `alg` values. Default `['RS256']`; `none` is never allowed. */
  algorithms?: string[]
  /** Allowed clock skew for `exp`, `nbf` and `iat`. Default 60. */
  clockToleranceSeconds?: number
  fetch?: typeof fetch
  now?: () => number
}

export interface VerifiedAccessToken {
  sub: string
  aud: string[]
  scopes: string[]
  principalType: 'user' | 'agent'
  tenantId?: string
  actor?: Record<string, unknown>
  jti?: string
  exp: number
  raw: Record<string, unknown>
}

export type AccessTokenErrorReason =
  | 'malformed'
  | 'wrong_type'
  | 'alg_not_allowed'
  | 'unknown_key'
  | 'key_alg_mismatch'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'

export class AccessTokenError extends Error {
  constructor(public readonly reason: AccessTokenErrorReason) {
    super(`Invalid access token: ${reason}`)
    this.name = 'AccessTokenError'
  }
}

const ACCEPTED_TYPES = new Set(['at+jwt', 'application/at+jwt'])
const DEFAULT_ALGORITHMS = ['RS256']

type Verifier = (input: string, signature: Buffer, key: KeyObject) => boolean
const hashVerifier =
  (hash: string, dsaEncoding?: 'ieee-p1363'): Verifier =>
  (input, signature, key) =>
    createVerify(hash).update(input).verify(dsaEncoding ? { key, dsaEncoding } : key, signature)
const VERIFIERS: Record<string, Verifier> = {
  RS256: hashVerifier('RSA-SHA256'),
  RS384: hashVerifier('RSA-SHA384'),
  RS512: hashVerifier('RSA-SHA512'),
  ES256: hashVerifier('SHA256', 'ieee-p1363'),
  ES384: hashVerifier('SHA384', 'ieee-p1363'),
  EdDSA: (input, signature, key) => verifyOneShot(null, Buffer.from(input), key, signature),
}

function decodeJson(part: string): Record<string, unknown> {
  const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
  return value as Record<string, unknown>
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export async function verifyAccessToken(token: string, options: VerifyAccessTokenOptions): Promise<VerifiedAccessToken> {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) throw new AccessTokenError('malformed')
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

  let header: Record<string, unknown>
  try {
    header = decodeJson(headerPart)
  } catch {
    throw new AccessTokenError('malformed')
  }

  if (typeof header.typ !== 'string' || !ACCEPTED_TYPES.has(header.typ.toLowerCase())) {
    throw new AccessTokenError('wrong_type')
  }

  const alg = header.alg
  const allowed = (options.algorithms ?? DEFAULT_ALGORITHMS).filter((candidate) => candidate !== 'none')
  if (typeof alg !== 'string' || !allowed.includes(alg) || !VERIFIERS[alg]) {
    throw new AccessTokenError('alg_not_allowed')
  }

  const issuer = stripTrailingSlash(options.issuer)
  const kid = header.kid
  if (typeof kid !== 'string') throw new AccessTokenError('unknown_key')
  const jwk: Jwk | null = await getJwk(options.jwksUri ?? `${issuer}/.well-known/jwks.json`, kid, {
    fetch: options.fetch,
    now: options.now,
  })
  if (!jwk) throw new AccessTokenError('unknown_key')
  // Each key is used with exactly one algorithm (RFC 8725 s3.1).
  if (jwk.alg && jwk.alg !== alg) throw new AccessTokenError('key_alg_mismatch')

  let valid: boolean
  try {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' })
    valid = VERIFIERS[alg]!(`${headerPart}.${payloadPart}`, Buffer.from(signaturePart, 'base64url'), key)
  } catch {
    valid = false
  }
  if (!valid) throw new AccessTokenError('bad_signature')

  let claims: Record<string, unknown>
  try {
    claims = decodeJson(payloadPart)
  } catch {
    throw new AccessTokenError('malformed')
  }

  if (typeof claims.iss !== 'string' || claims.iss !== issuer) throw new AccessTokenError('wrong_issuer')

  const aud =
    typeof claims.aud === 'string'
      ? [claims.aud]
      : Array.isArray(claims.aud)
        ? claims.aud.filter((value): value is string => typeof value === 'string')
        : []
  const expected = Array.isArray(options.audience) ? options.audience : [options.audience]
  if (!aud.some((value) => expected.includes(value))) throw new AccessTokenError('wrong_audience')

  const nowSeconds = (options.now ?? Date.now)() / 1000
  const tolerance = options.clockToleranceSeconds ?? 60
  if (typeof claims.exp !== 'number' || nowSeconds - tolerance >= claims.exp) throw new AccessTokenError('expired')
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + tolerance) throw new AccessTokenError('not_yet_valid')
  if (typeof claims.iat === 'number' && claims.iat > nowSeconds + tolerance) throw new AccessTokenError('not_yet_valid')

  if (typeof claims.sub !== 'string' || !claims.sub) throw new AccessTokenError('malformed')

  return {
    sub: claims.sub,
    aud,
    scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    principalType: claims.principal_type === 'agent' ? 'agent' : 'user',
    ...(typeof claims.tenant_id === 'string' ? { tenantId: claims.tenant_id } : {}),
    ...(claims.act && typeof claims.act === 'object' ? { actor: claims.act as Record<string, unknown> } : {}),
    ...(typeof claims.jti === 'string' ? { jti: claims.jti } : {}),
    exp: claims.exp,
    raw: claims,
  }
}
