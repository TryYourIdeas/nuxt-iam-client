import { describe, expect, it, vi, beforeEach } from 'vitest'
import { computed, ref } from 'vue'

// useAuthImpl() is a Nuxt composable - useRuntimeConfig/useState/useRequestFetch/
// $fetch/navigateTo are all auto-imported globals at runtime, which don't
// exist in a plain vitest environment. Stub them the same way the real app
// stubs Nuxt server auto-imports in test/unit/admin-auth.test.ts (home).
const requestFetchMock = vi.fn()
const fetchMock = vi.fn()
const navigateToMock = vi.fn()

vi.stubGlobal('useRuntimeConfig', () =>
  ({ public: { iamClient: { test: { routePrefix: '/custom/prefix', afterLogoutPath: '/bye' } } } }))
vi.stubGlobal('useState', () => ref(null))
vi.stubGlobal('computed', computed)
vi.stubGlobal('useRequestFetch', () => requestFetchMock)
vi.stubGlobal('$fetch', fetchMock)
vi.stubGlobal('navigateTo', navigateToMock)

describe('useAuthImpl composable', () => {
  beforeEach(() => {
    requestFetchMock.mockReset().mockResolvedValue({ user: null })
    fetchMock.mockReset().mockResolvedValue(undefined)
    navigateToMock.mockReset()
  })

  it('fetchSession() calls `${routePrefix}/session`, not a hardcoded path', async () => {
    const { useAuthImpl } = await import('../src/runtime/composables/useAuth')
    const { fetchSession } = useAuthImpl('test')

    await fetchSession()

    expect(requestFetchMock).toHaveBeenCalledWith('/custom/prefix/session')
  })

  it('logout() calls `${routePrefix}/logout`, not a hardcoded path', async () => {
    const { useAuthImpl } = await import('../src/runtime/composables/useAuth')
    const { logout } = useAuthImpl('test')

    await logout()

    expect(fetchMock).toHaveBeenCalledWith('/custom/prefix/logout', { method: 'POST' })
    expect(navigateToMock).toHaveBeenCalledWith('/bye')
  })
})
