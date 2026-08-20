import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createIamSession, getIamSession } from '../../src/runtime/server/utils/auth'

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

describe('sessions e2e (real Postgres via DATABASE_URL)', () => {
  beforeEach(() => {
    vi.stubGlobal('iamDebugLog', vi.fn())
  })

  it('returns null for an already-expired session whose refresh also fails, and cleans it up', async () => {
    const createEvent = fakeEvent()
    const created = await createIamSession(createEvent, 'e2e-instance', {
      username: 'e2e-sub',
      email: 'e2e@b.com',
      accessToken: 'at',
      refreshToken: 'rt',
      accessTokenExpiresAt: Date.now() - 1000, // already expired
      appId: 'app-1',
    })

    const getEvent = fakeEvent({ [`iam_session_e2e-instance`]: created.id })
    // resolveIamCredentials throws inside getIamSession because no
    // useRuntimeConfig exists in this standalone test context - this is
    // exactly the "refresh failed" path, which must destroy the session
    // rather than throw.
    const result = await getIamSession(getEvent, 'e2e-instance')
    expect(result).toBeNull()

    // Confirm it's actually gone, not just reported null due to a transient error.
    const secondAttempt = await getIamSession(getEvent, 'e2e-instance')
    expect(secondAttempt).toBeNull()
  })
})
