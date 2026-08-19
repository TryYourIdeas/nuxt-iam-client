import type { H3Event } from 'h3'
import { getRequestURL, sendRedirect } from 'h3'
import type { IdClaims, TokenResponse, AuthAttempt } from '../utils/auth'

interface IamClientPublicConfig {
  notAuthenticatedPath: string
}

export default defineEventHandler(async (event) => {
  const instanceId = event.context.iamInstanceId as string | undefined
  if (!instanceId) {
    throw new Error('nuxt-iam-client: middleware ran without event.context.iamInstanceId set — check the module wrapper template')
  }

  const url = getRequestURL(event)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code && !state) return

  const attempt = getAuthAttempt(event, instanceId)
  if (!attempt) {
    // Not this mount's callback (no matching iam_attempt_<instanceId> cookie)
    // - another mount's middleware, running later in the stack, may still
    // own it. Pass through instead of failing.
    iamDebugLog('callback', 'no attempt cookie for this mount, passing through', { instanceId })
    return
  }

  if (!code || !state) {
    return fail(event, instanceId, 'malformed callback: only one of code/state present on request')
  }

  return handleAuthCallback(event, instanceId, code, state, attempt)
})

async function publicConfigFor(event: H3Event, instanceId: string): Promise<IamClientPublicConfig> {
  const config = useRuntimeConfig(event) as unknown as { public: { iamClient?: Record<string, IamClientPublicConfig> } }
  const entry = config.public.iamClient?.[instanceId]
  if (!entry) throw new Error(`nuxt-iam-client: no public config registered for instanceId "${instanceId}"`)
  return entry
}

async function fail(event: H3Event, instanceId: string, reason: string) {
  iamDebugLog('callback', `rejecting callback: ${reason}`, { instanceId })
  const publicConfig = await publicConfigFor(event, instanceId)
  return sendRedirect(event, publicConfig.notAuthenticatedPath)
}

async function handleAuthCallback(event: H3Event, instanceId: string, code: string, state: string, attempt: AuthAttempt) {
  const url = getRequestURL(event)

  if (state !== attempt.state) return fail(event, instanceId, 'state mismatch')

  const credentials = await resolveIamCredentials(event, instanceId)
  if (!credentials) return fail(event, instanceId, 'no iam credentials resolved for this request')

  let tokens: TokenResponse
  try {
    tokens = await exchangeCode(credentials, code)
  } catch (error) {
    return fail(event, instanceId, `code exchange threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!tokens.id_token) return fail(event, instanceId, 'token response missing id_token')

  let idClaims: IdClaims
  try {
    idClaims = decodeJwtPayload(tokens.id_token) as unknown as IdClaims
  } catch {
    return fail(event, instanceId, 'id_token could not be decoded')
  }

  if (idClaims.nonce !== attempt.nonce) return fail(event, instanceId, 'nonce mismatch')
  if (!audienceMatches(idClaims.aud, credentials.appId)) return fail(event, instanceId, 'audience does not match resolved app id')
  if (Date.now() >= idClaims.exp * 1000) return fail(event, instanceId, 'id_token already expired')

  await createIamSession(event, instanceId, {
    username: idClaims.sub,
    email: tokens.user_email,
    accessToken: tokens.token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    appId: credentials.appId,
  })

  clearAuthAttempt(event, instanceId)

  iamDebugLog('callback', 'callback succeeded', { instanceId, email: tokens.user_email, redirectTo: url.pathname })

  return sendRedirect(event, url.pathname)
}
