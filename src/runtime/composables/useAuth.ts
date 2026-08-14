export interface AuthUser {
  username: string
  email: string
}

export function useAuth() {
  const config = useRuntimeConfig()
  const user = useState<AuthUser | null>('auth-user', () => null)
  const status = computed(() => (user.value ? 'authenticated' : 'unauthenticated'))
  const requestFetch = useRequestFetch()

  async function fetchSession(): Promise<AuthUser | null> {
    const data = await requestFetch<{ user: AuthUser | null }>('/api/auth/session')
    user.value = data.user
    return data.user
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo(config.public.iamClient.afterLogoutPath)
  }

  return { user, status, fetchSession, logout }
}
