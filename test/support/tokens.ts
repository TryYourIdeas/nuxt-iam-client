import { createSign, generateKeyPairSync } from 'node:crypto'
import { vi } from 'vitest'

export const ISSUER = 'https://iam.example.com'
export const AUDIENCE = 'https://acme.example.com/myteam'
export const NOW_S = 1_800_000_000

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
export const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }

export const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

function sign(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const input = `${b64(header)}.${b64(payload)}`
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')
  return `${input}.${signature}`
}

/** A valid iam access token for AUDIENCE at NOW_S, with optional claim/header overrides. */
export function token(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  return sign(
    { alg: 'RS256', typ: 'at+jwt', kid: 'k1', ...header },
    { iss: ISSUER, sub: 'alice', aud: AUDIENCE, scope: 'openid email', iat: NOW_S - 10, exp: NOW_S + 300, ...payload },
  )
}

/** A fetch double serving the JWKS with `publicJwk`. */
export function jwksFetch() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) }) as unknown as Response)
}
