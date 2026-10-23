import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('h3', () => ({
  getRequestURL: (event: { url: string }) => new URL(event.url),
  sendRedirect: vi.fn((_event: unknown, to: string) => ({ redirectedTo: to })),
}))

const attempts: Record<string, { state: string; nonce: string } | null> = {}
const exchangeCode = vi.fn()
const resolveIamCredentials = vi.fn()
const clearAuthAttempt = vi.fn()

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
vi.stubGlobal('iamDebugLog', vi.fn())
vi.stubGlobal('getAuthAttempt', (_e: unknown, instanceId: string) => attempts[instanceId] ?? null)
vi.stubGlobal('clearAuthAttempt', clearAuthAttempt)
vi.stubGlobal('resolveIamCredentials', resolveIamCredentials)
vi.stubGlobal('exchangeCode', exchangeCode)
vi.stubGlobal('useRuntimeConfig', () => ({
  public: { iamClient: { admin: { notAuthenticatedPath: '/admin/not-authenticated' }, tenant: { notAuthenticatedPath: '/not-authenticated' } } },
}))

const eventFor = (instanceId: string, query: string) => ({
  url: `https://home.example.com/authenticated?${query}`,
  context: { iamInstanceId: instanceId },
})

describe('callback middleware with several mounts on one origin', () => {
  beforeEach(() => {
    for (const k of Object.keys(attempts)) delete attempts[k]
    exchangeCode.mockReset()
    resolveIamCredentials.mockReset()
    clearAuthAttempt.mockReset()
  })

  it('passes a callback through when this mount holds a stale attempt with a different state', async () => {
    attempts.admin = { state: 'stale-admin-state', nonce: 'n' }
    const handler = (await import('../src/runtime/server/middleware/auth')).default as (e: unknown) => Promise<unknown>

    const result = await handler(eventFor('admin', 'code=abc&state=tenant-state'))

    expect(result).toBeUndefined() // not redirected to /admin/not-authenticated
    expect(resolveIamCredentials).not.toHaveBeenCalled()
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(clearAuthAttempt).not.toHaveBeenCalled() // the stale cookie is left alone
  })

  it('still completes the callback in the mount whose attempt state matches', async () => {
    attempts.admin = { state: 'stale-admin-state', nonce: 'n' }
    attempts.tenant = { state: 'tenant-state', nonce: 'n' }
    resolveIamCredentials.mockResolvedValue(null) // stops right after the state check, enough to prove ownership
    const handler = (await import('../src/runtime/server/middleware/auth')).default as (e: unknown) => Promise<unknown>

    await handler(eventFor('tenant', 'code=abc&state=tenant-state'))

    expect(resolveIamCredentials).toHaveBeenCalledTimes(1)
  })

  it('passes through when this mount has no attempt cookie at all', async () => {
    const handler = (await import('../src/runtime/server/middleware/auth')).default as (e: unknown) => Promise<unknown>

    expect(await handler(eventFor('admin', 'code=abc&state=x'))).toBeUndefined()
    expect(resolveIamCredentials).not.toHaveBeenCalled()
  })
})
