import { describe, expect, it } from 'vitest'
import { audienceMatches, decodeJwtPayload } from '../src/runtime/server/utils/auth'

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
