import { createSign, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessTokenError, verifyAccessToken, type VerifyAccessTokenOptions } from '../src/runtime/server/utils/accessToken'
import { resetJwksCacheForTests } from '../src/runtime/server/utils/jwks'
import { AUDIENCE, ISSUER, NOW_S, b64, publicJwk, token } from './support/tokens'

const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) }) as unknown as Response)

function options(overrides: Partial<VerifyAccessTokenOptions> = {}): VerifyAccessTokenOptions {
  return { issuer: ISSUER, audience: AUDIENCE, fetch: fetchMock, now: () => NOW_S * 1000, ...overrides }
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(AccessTokenError)
  return (error as AccessTokenError).reason
}

describe('verifyAccessToken', () => {
  beforeEach(() => {
    resetJwksCacheForTests()
    fetchMock.mockClear()
  })

  it('accepts a valid user access token and returns its claims', async () => {
    const verified = await verifyAccessToken(token({ tenant_id: 'acme', jti: 'j1' }), options())
    expect(verified).toMatchObject({
      sub: 'alice',
      aud: [AUDIENCE],
      scopes: ['openid', 'email'],
      principalType: 'user',
      tenantId: 'acme',
      jti: 'j1',
      exp: NOW_S + 300,
    })
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/.well-known/jwks.json`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('reports agent tokens and the acting party', async () => {
    const verified = await verifyAccessToken(
      token({ principal_type: 'agent', act: { sub: 'flow-engine' }, scope: undefined }),
      options(),
    )
    expect(verified.principalType).toBe('agent')
    expect(verified.actor).toEqual({ sub: 'flow-engine' })
    expect(verified.scopes).toEqual([])
  })

  it('accepts application/at+jwt and an array audience containing ours', async () => {
    await expect(
      verifyAccessToken(token({ aud: ['other', AUDIENCE] }, { typ: 'application/at+jwt' }), options()),
    ).resolves.toMatchObject({ sub: 'alice' })
  })

  it('matches an issuer option given with a trailing slash', async () => {
    await expect(verifyAccessToken(token(), options({ issuer: `${ISSUER}/` }))).resolves.toMatchObject({ sub: 'alice' })
  })

  it('rejects an ID token (typ JWT) even though its signature is valid', async () => {
    expect(await reasonOf(verifyAccessToken(token({}, { typ: 'JWT' }), options()))).toBe('wrong_type')
  })

  it.each(['none', 'HS256'])('rejects alg %s before looking up any key', async (alg) => {
    expect(await reasonOf(verifyAccessToken(token({}, { alg }), options({ algorithms: ['RS256', 'none'] })))).toBe(
      'alg_not_allowed',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a key whose published algorithm differs from the header', async () => {
    fetchMock.mockImplementationOnce(
      async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ ...publicJwk, alg: 'RS512' }] }) }) as unknown as Response,
    )
    expect(await reasonOf(verifyAccessToken(token(), options()))).toBe('key_alg_mismatch')
  })

  it('rejects an unknown kid', async () => {
    expect(await reasonOf(verifyAccessToken(token({}, { kid: 'nope' }), options()))).toBe('unknown_key')
  })

  it('rejects a tampered payload', async () => {
    const [header, , signature] = token().split('.')
    const forged = `${header}.${b64({ iss: ISSUER, sub: 'mallory', aud: AUDIENCE, exp: NOW_S + 300 })}.${signature}`
    expect(await reasonOf(verifyAccessToken(forged, options()))).toBe('bad_signature')
  })

  it('rejects another issuer', async () => {
    expect(await reasonOf(verifyAccessToken(token({ iss: 'iam' }), options()))).toBe('wrong_issuer')
  })

  it('rejects a token for another audience', async () => {
    expect(await reasonOf(verifyAccessToken(token({ aud: 'https://other.example.com' }), options()))).toBe('wrong_audience')
  })

  it('allows 60 seconds of clock skew on exp and no more', async () => {
    await expect(verifyAccessToken(token({ exp: NOW_S - 59 }), options())).resolves.toMatchObject({ sub: 'alice' })
    expect(await reasonOf(verifyAccessToken(token({ exp: NOW_S - 61 }), options()))).toBe('expired')
  })

  it('rejects a token that is not valid yet', async () => {
    expect(await reasonOf(verifyAccessToken(token({ nbf: NOW_S + 120 }), options()))).toBe('not_yet_valid')
  })

  it.each([
    ['two parts', 'a.b'],
    ['bad base64 header', '!!!.e30.sig'],
    ['non-JSON header', `${Buffer.from('nope').toString('base64url')}.e30.sig`],
  ])('rejects a malformed token (%s)', async (_label, value) => {
    expect(await reasonOf(verifyAccessToken(value, options()))).toBe('malformed')
  })

  describe('key type is bound to the algorithm', () => {
    function tokenSignedBy(privateKey: Parameters<ReturnType<typeof createSign>['sign']>[0], kid: string) {
      const input = `${b64({ alg: 'RS256', typ: 'at+jwt', kid })}.${b64({ iss: ISSUER, sub: 'alice', aud: AUDIENCE, exp: NOW_S + 300 })}`
      return `${input}.${createSign('SHA256').update(input).sign(privateKey).toString('base64url')}`
    }
    function serving(jwk: Record<string, unknown>) {
      return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) }) as unknown as Response)
    }

    it('refuses an EC key presented for RS256', async () => {
      const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const jwk = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec1' }
      expect(await reasonOf(verifyAccessToken(tokenSignedBy(ec.privateKey, 'ec1'), options({ fetch: serving(jwk) })))).toBe(
        'key_type_mismatch',
      )
    })

    it('refuses an RSA key shorter than 2048 bits', async () => {
      const weak = generateKeyPairSync('rsa', { modulusLength: 1024 })
      const jwk = { ...weak.publicKey.export({ format: 'jwk' }), kid: 'weak' }
      expect(await reasonOf(verifyAccessToken(tokenSignedBy(weak.privateKey, 'weak'), options({ fetch: serving(jwk) })))).toBe(
        'weak_key',
      )
    })

    it('refuses a key published for encryption', async () => {
      expect(
        await reasonOf(verifyAccessToken(token(), options({ fetch: serving({ ...publicJwk, use: 'enc' }) }))),
      ).toBe('key_type_mismatch')
    })

    it('accepts an RSA key whose JWK omits alg', async () => {
      const { alg: _alg, ...withoutAlg } = publicJwk
      await expect(verifyAccessToken(token(), options({ fetch: serving(withoutAlg) }))).resolves.toMatchObject({ sub: 'alice' })
    })
  })
})
