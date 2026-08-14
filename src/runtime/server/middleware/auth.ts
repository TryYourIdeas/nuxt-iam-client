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
      return sendRedirect(event, config.public.iamClient.notAuthenticatedPath)
    }
    return handleAuthCallback(event, code, state)
  }
})

async function handleAuthCallback(event: H3Event, code: string, state: string) {
  const config = useRuntimeConfig(event)
  const url = getRequestURL(event)

  const fail = () => sendRedirect(event, config.public.iamClient.notAuthenticatedPath)

  const attempt = getAuthAttempt(event)
  if (!attempt) return fail()
  if (state !== attempt.state) return fail()

  let tokens: TokenResponse
  try {
    tokens = await exchangeCode(event, code)
  } catch {
    return fail()
  }

  if (!tokens.id_token) return fail()

  let idClaims: IdClaims
  try {
    idClaims = decodeJwtPayload(tokens.id_token) as unknown as IdClaims
  } catch {
    return fail()
  }

  if (idClaims.nonce !== attempt.nonce) return fail()
  if (!audienceMatches(idClaims.aud, config.iam.appId)) return fail()
  if (Date.now() >= idClaims.exp * 1000) return fail()

  await createIamSession(event, {
    username: idClaims.sub,
    email: tokens.user_email,
    accessToken: tokens.token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  })

  clearAuthAttempt(event)

  return sendRedirect(event, url.pathname)
}
