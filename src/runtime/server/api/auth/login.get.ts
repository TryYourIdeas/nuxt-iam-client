import { sendRedirect } from 'h3'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  const session = await getIamSession(event)
  if (session) {
    iamDebugLog('login', 'already has a valid session, skipping iam redirect', { email: session.email })
    return sendRedirect(event, config.public.iamClient.afterLoginPath)
  }

  const attempt = generateAttempt()
  setAuthAttempt(event, attempt)

  const redirectUrl = buildAuthorizationUrl(config.iam.url, config.iam.appId, attempt)
  iamDebugLog('login', 'redirecting to iam for authorization', { iamUrl: config.iam.url, appId: config.iam.appId, redirectUrl })
  return sendRedirect(event, redirectUrl)
})
