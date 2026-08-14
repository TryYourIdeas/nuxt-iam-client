import { sendRedirect } from 'h3'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  const session = await getIamSession(event)
  if (session) {
    return sendRedirect(event, config.public.iamClient.afterLoginPath)
  }

  const attempt = generateAttempt()
  setAuthAttempt(event, attempt)

  const redirectUrl = buildAuthorizationUrl(config.iam.url, config.iam.appId, attempt)
  return sendRedirect(event, redirectUrl)
})
