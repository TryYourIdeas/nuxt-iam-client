import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { getCookie, setCookie, deleteCookie } from 'h3'

export interface AuthAttempt {
  state: string
  nonce: string
}

export interface TokenResponse {
  token: string
  id_token: string
  refresh_token: string
  user_email: string
  expires_in: number
}

export interface RefreshResponse {
  token: string
  refresh_token: string
  user_email: string
  expires_in: number
}

export interface TokenErrorResponse {
  error: string
  message: string
}

export interface Session {
  id: string
  username: string
  email: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: number
}

export interface IdClaims {
  sub: string
  email: string
  aud: string | string[]
  iss: string
  exp: number
  nonce: string
}

const ATTEMPT_COOKIE = 'iam_attempt'
const SESSION_COOKIE = 'iam_session'
const STORAGE_KEY = 'iam:sessions'

function iamBaseUrl(iamUrl: string): string {
  return iamUrl.replace(/\/+$/, '')
}

export function generateAttempt(): AuthAttempt {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
  }
}

export function buildAuthorizationUrl(iamUrl: string, appId: string, attempt: AuthAttempt): string {
  const params = new URLSearchParams({
    app_id: appId,
    state: attempt.state,
    nonce: attempt.nonce,
  })
  return `${iamBaseUrl(iamUrl)}/auth?${params.toString()}`
}

export function setAuthAttempt(event: H3Event, attempt: AuthAttempt) {
  setCookie(event, ATTEMPT_COOKIE, JSON.stringify(attempt), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60,
    path: '/',
  })
}

export function getAuthAttempt(event: H3Event): AuthAttempt | null {
  const raw = getCookie(event, ATTEMPT_COOKIE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthAttempt
  } catch {
    return null
  }
}

export function clearAuthAttempt(event: H3Event) {
  deleteCookie(event, ATTEMPT_COOKIE)
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payloadPart = jwt.split('.')[1]
  if (!payloadPart) {
    throw new Error('Invalid JWT')
  }
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
}

export async function exchangeCode(event: H3Event, code: string): Promise<TokenResponse> {
  const { iam } = useRuntimeConfig(event)
  const response = await fetch(`${iamBaseUrl(iam.url)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: iam.appId,
      client_secret: iam.clientSecret,
    }),
  })

  if (!response.ok) {
    const error = (await response.json()) as TokenErrorResponse
    throw new Error(`Token exchange failed: ${error.error} — ${error.message}`)
  }

  return (await response.json()) as TokenResponse
}

export async function refreshAccessToken(event: H3Event, refreshToken: string): Promise<RefreshResponse> {
  const { iam } = useRuntimeConfig(event)
  const response = await fetch(`${iamBaseUrl(iam.url)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: iam.appId,
      client_secret: iam.clientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error('Refresh failed')
  }

  return (await response.json()) as RefreshResponse
}

export async function createIamSession(
  event: H3Event,
  data: Omit<Session, 'id'>,
): Promise<Session> {
  const id = randomBytes(32).toString('base64url')
  const session: Session = { id, ...data }
  await useStorage(STORAGE_KEY).setItem(id, session)
  setCookie(event, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return session
}

export async function getIamSession(event: H3Event): Promise<Session | null> {
  const id = getCookie(event, SESSION_COOKIE)
  if (!id) return null

  const storage = useStorage(STORAGE_KEY)
  const session = (await storage.getItem(id)) as Session | null
  if (!session) return null

  if (Date.now() >= session.accessTokenExpiresAt) {
    try {
      const refreshed = await refreshAccessToken(event, session.refreshToken)
      session.accessToken = refreshed.token
      session.refreshToken = refreshed.refresh_token
      session.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000
      await storage.setItem(id, session)
    } catch {
      await destroyIamSession(event)
      return null
    }
  }

  return session
}

export async function destroyIamSession(event: H3Event) {
  const id = getCookie(event, SESSION_COOKIE)
  if (id) await useStorage(STORAGE_KEY).removeItem(id)
  deleteCookie(event, SESSION_COOKIE)
}

export function audienceMatches(aud: string | string[], appId: string): boolean {
  if (Array.isArray(aud)) return aud.includes(appId)
  return aud === appId
}
