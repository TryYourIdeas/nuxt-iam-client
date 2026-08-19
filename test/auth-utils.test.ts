import { describe, expect, it } from 'vitest'
import { audienceMatches, decodeJwtPayload } from '../src/runtime/server/utils/auth'
import { attemptCookieName, sessionCookieName, sessionStorageNamespace } from '../src/runtime/server/utils/auth'

describe('decodeJwtPayload', () => {
  it('decodes the base64url payload segment', () => {
    const payload = { sub: 'alice', aud: 'test-app', exp: 123, nonce: 'abc' }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const jwt = `header.${encoded}.signature`

    expect(decodeJwtPayload(jwt)).toEqual(payload)
  })

  it('throws on a malformed token with no payload segment', () => {
    expect(() => decodeJwtPayload('not-a-jwt')).toThrow('Invalid JWT')
  })
})

describe('audienceMatches', () => {
  it('matches a single string audience', () => {
    expect(audienceMatches('test-app', 'test-app')).toBe(true)
    expect(audienceMatches('other-app', 'test-app')).toBe(false)
  })

  it('matches when the audience is an array containing the app id', () => {
    expect(audienceMatches(['other-app', 'test-app'], 'test-app')).toBe(true)
    expect(audienceMatches(['other-app'], 'test-app')).toBe(false)
  })
})

describe('instance-scoped naming', () => {
  it('derives distinct cookie names per instanceId', () => {
    expect(attemptCookieName('admin')).toBe('iam_attempt_admin')
    expect(attemptCookieName('tenant')).toBe('iam_attempt_tenant')
    expect(sessionCookieName('admin')).toBe('iam_session_admin')
    expect(sessionCookieName('tenant')).toBe('iam_session_tenant')
  })

  it('derives distinct storage namespaces per instanceId', () => {
    expect(sessionStorageNamespace('admin')).toBe('iam:sessions:admin')
    expect(sessionStorageNamespace('tenant')).toBe('iam:sessions:tenant')
  })
})
