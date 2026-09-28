import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { audienceMatches, decodeJwtPayload } from '../src/runtime/server/utils/auth'
import { attemptCookieName, sessionCookieName, resolveIamCredentials } from '../src/runtime/server/utils/auth'
import { createIamSession, getIamSession, setIamSessionMetadata, destroyIamSession } from '../src/runtime/server/utils/auth'

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
})

describe('resolveIamCredentials', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a static instance\'s credentials from the top-level runtimeConfig.iam, not a value captured at module-setup time', async () => {
    // Regression test: an earlier version of this module captured
    // options.iam into runtimeConfig.iamClientInstances[instanceId].iam at
    // build time, which broke Nitro's NUXT_IAM_URL/NUXT_IAM_APP_ID/
    // NUXT_IAM_APP_SECRET runtime env-var override (Nitro only
    // overrides the exact path a value was registered at). This asserts
    // resolveIamCredentials reflects whatever runtimeConfig.iam holds *at
    // call time*, simulating a runtime override having changed it after
    // module setup ran.
    const runtimeIam = { url: 'https://iam.example.com', appId: 'runtime-app-id', appSecret: 'runtime-secret' }
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

function fakeEvent(cookies: Record<string, string> = {}) {
  const store = { ...cookies }
  const resHeaders = new Map<string, string>()
  return {
    node: {
      req: { headers: { cookie: Object.entries(store).map(([k, v]) => `${k}=${v}`).join('; ') } },
      res: {
        getHeader: (name: string) => resHeaders.get(name),
        setHeader: (name: string, value: string) => resHeaders.set(name, value),
        removeHeader: (name: string) => resHeaders.delete(name),
      },
    },
  } as any
}

// These tests hit a real local Postgres (set DATABASE_URL before running) -
// there is no mock-based path here, since the whole point is verifying real
// persistence across the create/get/destroy round trip.
describe('session persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('iamDebugLog', vi.fn())
  })

  it('round-trips a session through create -> get -> destroy', async () => {
    const event = fakeEvent()
    const created = await createIamSession(event, 'test-instance', {
      username: 'sub-1',
      email: 'a@b.com',
      accessToken: 'at',
      refreshToken: 'rt',
      accessTokenExpiresAt: Date.now() + 60_000,
      appId: 'app-1',
    })
    expect(created.id).toBeTruthy()

    const getEvent = fakeEvent({ [`iam_session_test-instance`]: created.id })
    const fetched = await getIamSession(getEvent, 'test-instance')
    expect(fetched?.email).toBe('a@b.com')

    await destroyIamSession(getEvent, 'test-instance')
    const afterDestroy = await getIamSession(getEvent, 'test-instance')
    expect(afterDestroy).toBeNull()
  })

  it('keeps sessions isolated by instanceId', async () => {
    const event = fakeEvent()
    const created = await createIamSession(event, 'instance-a', {
      username: 'sub-2',
      email: 'iso@b.com',
      accessToken: 'at',
      refreshToken: 'rt',
      accessTokenExpiresAt: Date.now() + 60_000,
      appId: 'app-1',
    })

    const wrongInstanceEvent = fakeEvent({ [`iam_session_instance-b`]: created.id })
    expect(await getIamSession(wrongInstanceEvent, 'instance-b')).toBeNull()
  })

  it('merges metadata via setIamSessionMetadata', async () => {
    const event = fakeEvent()
    const created = await createIamSession(event, 'meta-instance', {
      username: 'sub-3',
      email: 'meta@b.com',
      accessToken: 'at',
      refreshToken: 'rt',
      accessTokenExpiresAt: Date.now() + 60_000,
      appId: 'app-1',
    })

    const sessionEvent = fakeEvent({ [`iam_session_meta-instance`]: created.id })
    await setIamSessionMetadata(sessionEvent, 'meta-instance', { tenantUserId: 'u1' })
    const fetched = await getIamSession(sessionEvent, 'meta-instance')
    expect(fetched?.metadata).toEqual({ tenantUserId: 'u1' })
  })
})
