import { sendRedirect } from 'h3'

export default defineEventHandler(async (event) => {
  const instanceId = event.context.iamInstanceId as string
  const config = useRuntimeConfig(event) as unknown as {
    public: { iamClient: Record<string, { afterLoginPath: string }> }
  }
  const publicConfig = config.public.iamClient[instanceId]

  const session = await getIamSession(event, instanceId)
  if (session) {
    iamDebugLog('login', 'already has a valid session, skipping iam redirect', { instanceId, email: session.email })
    return sendRedirect(event, publicConfig.afterLoginPath)
  }

  const credentials = await resolveIamCredentials(event, instanceId)
  if (!credentials) {
    iamDebugLog('login', 'no iam credentials resolved, cannot start login', { instanceId })
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const attempt = generateAttempt()
  setAuthAttempt(event, instanceId, attempt)

  const redirectUrl = buildAuthorizationUrl(credentials.url, credentials.appId, attempt)
  iamDebugLog('login', 'redirecting to iam for authorization', { instanceId, iamUrl: credentials.url, appId: credentials.appId, redirectUrl })
  return sendRedirect(event, redirectUrl)
})

function buildAuthorizationUrl(iamUrl: string, appId: string, attempt: { state: string; nonce: string }): string {
  const params = new URLSearchParams({ app_id: appId, state: attempt.state, nonce: attempt.nonce })
  return `${iamUrl.replace(/\/+$/, '')}/auth?${params.toString()}`
}
