import { describe, expect, it, vi, afterEach } from 'vitest'
import { audienceMatches, decodeJwtPayload } from '../src/runtime/server/utils/auth'
import { attemptCookieName, sessionCookieName, sessionStorageNamespace, resolveIamCredentials } from '../src/runtime/server/utils/auth'

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

describe('resolveIamCredentials', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a static instance\'s credentials from the top-level runtimeConfig.iam, not a value captured at module-setup time', async () => {
    // Regression test: an earlier version of this module captured
    // options.iam into runtimeConfig.iamClientInstances[instanceId].iam at
    // build time, which broke Nitro's NUXT_IAM_URL/NUXT_IAM_APP_ID/
    // NUXT_IAM_CLIENT_SECRET runtime env-var override (Nitro only
    // overrides the exact path a value was registered at). This asserts
    // resolveIamCredentials reflects whatever runtimeConfig.iam holds *at
    // call time*, simulating a runtime override having changed it after
    // module setup ran.
    const runtimeIam = { url: 'https://iam.example.com', appId: 'runtime-app-id', clientSecret: 'runtime-secret' }
    vi.stubGlobal('useRuntimeConfig', () => ({
      iamClientInstances: { admin: { dynamic: false } },
      iam: runtimeIam,
    }))

    const credentials = await resolveIamCredentials({} as never, 'admin')

    expect(credentials).toEqual(runtimeIam)
  })

  it('throws for an unregistered instanceId', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ iamClientInstances: {} }))

    await expect(resolveIamCredentials({} as never, 'unknown')).rejects.toThrow('unknown instanceId "unknown"')
  })
})
