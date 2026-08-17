import type { H3Event } from 'h3'
import { getRequestURL, sendRedirect } from 'h3'
import type { IdClaims, TokenResponse } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const url = getRequestURL(event)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (code || state) {
    if (!code || !state) {
      iamDebugLog('callback', 'rejecting callback: only one of code/state present on request')
      return sendRedirect(event, config.public.iamClient.notAuthenticatedPath)
    }
    return handleAuthCallback(event, code, state)
  }
})

async function handleAuthCallback(event: H3Event, code: string, state: string) {
  const config = useRuntimeConfig(event)
  const url = getRequestURL(event)

  const fail = (reason: string) => {
    iamDebugLog('callback', `rejecting callback: ${reason}`)
    return sendRedirect(event, config.public.iamClient.notAuthenticatedPath)
  }

  const attempt = getAuthAttempt(event)
  if (!attempt) return fail('no auth attempt cookie (expired, cleared, or callback replayed)')
  if (state !== attempt.state) return fail('state mismatch')

  let tokens: TokenResponse
  try {
    tokens = await exchangeCode(event, code)
  } catch (error) {
    return fail(`code exchange threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!tokens.id_token) return fail('token response missing id_token')

  let idClaims: IdClaims
  try {
    idClaims = decodeJwtPayload(tokens.id_token) as unknown as IdClaims
  } catch {
    return fail('id_token could not be decoded')
  }

  if (idClaims.nonce !== attempt.nonce) return fail('nonce mismatch')
  if (!audienceMatches(idClaims.aud, config.iam.appId)) return fail('audience does not match configured NUXT_IAM_APP_ID')
  if (Date.now() >= idClaims.exp * 1000) return fail('id_token already expired')

  await createIamSession(event, {
    username: idClaims.sub,
    email: tokens.user_email,
    accessToken: tokens.token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  })

  clearAuthAttempt(event)

  iamDebugLog('callback', 'callback succeeded', { email: tokens.user_email, redirectTo: url.pathname })

  return sendRedirect(event, url.pathname)
}
