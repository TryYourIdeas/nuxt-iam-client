export interface AuthUser {
  username: string
  email: string
}

export function useAuthImpl(instanceId: string) {
  const config = useRuntimeConfig()
  const publicConfig = (config.public.iamClient as Record<string, { routePrefix: string; afterLogoutPath: string }>)[instanceId]
  const user = useState<AuthUser | null>(`auth-user-${instanceId}`, () => null)
  const status = computed(() => (user.value ? 'authenticated' : 'unauthenticated'))
  const requestFetch = useRequestFetch()

  async function fetchSession(): Promise<AuthUser | null> {
    const data = await requestFetch<{ user: AuthUser | null }>(`${publicConfig.routePrefix}/session`)
    user.value = data.user
    return data.user
  }

  async function logout() {
    await $fetch(`${publicConfig.routePrefix}/logout`, { method: 'POST' })
    user.value = null
    await navigateTo(publicConfig.afterLogoutPath)
  }

  return { user, status, fetchSession, logout }
}
