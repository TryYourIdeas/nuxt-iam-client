import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { getCookie, setCookie, deleteCookie } from 'h3'
import { and, eq } from 'drizzle-orm'
import { getSessionsDb } from '../db/client'
import { iamClientSessions, type IamClientSessionRow } from '../db/schema'

export interface AuthAttempt {
  state: string
  nonce: string
}

export interface IamCredentials {
  url: string
  appId: string
  appSecret: string
}

export interface IamClientInstanceConfig {
  dynamic: boolean
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
  appId: string
  metadata?: Record<string, unknown>
}

export interface IdClaims {
  sub: string
  email: string
  aud: string | string[]
  iss: string
  exp: number
  nonce: string
}

function iamBaseUrl(iamUrl: string): string {
  return iamUrl.replace(/\/+$/, '')
}

export function attemptCookieName(instanceId: string): string {
  return `iam_attempt_${instanceId}`
}

export function sessionCookieName(instanceId: string): string {
  return `iam_session_${instanceId}`
}

export function generateAttempt(): AuthAttempt {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
  }
}

export function setAuthAttempt(event: H3Event, instanceId: string, attempt: AuthAttempt) {
  setCookie(event, attemptCookieName(instanceId), JSON.stringify(attempt), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60,
    path: '/',
  })
}

export function getAuthAttempt(event: H3Event, instanceId: string): AuthAttempt | null {
  const raw = getCookie(event, attemptCookieName(instanceId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthAttempt
  } catch {
    return null
  }
}

export function clearAuthAttempt(event: H3Event, instanceId: string) {
  deleteCookie(event, attemptCookieName(instanceId))
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payloadPart = jwt.split('.')[1]
  if (!payloadPart) {
    throw new Error('Invalid JWT')
  }
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
}

/**
 * Resolves the {url, appId, appSecret} this instance should use for the
 * current request. Static instances return their fixed config; dynamic
 * instances (one mount serving many logical clients, e.g. one per tenant)
 * delegate to `resolveIamAppCredentials`, a server util the CONSUMING app
 * must define and which gets auto-imported into this same Nitro build
 * alongside this module's own utils (same mechanism `iamDebugLog`/
 * `getIamSession` already rely on being auto-imported into consumers).
 */
export async function resolveIamCredentials(event: H3Event, instanceId: string): Promise<IamCredentials | null> {
  const config = useRuntimeConfig(event) as unknown as {
    iamClientInstances?: Record<string, IamClientInstanceConfig>
    iam?: IamCredentials
  }
  const instance = config.iamClientInstances?.[instanceId]
  if (!instance) {
    throw new Error(`nuxt-iam-client: unknown instanceId "${instanceId}" (no module mount registered it)`)
  }
  if (!instance.dynamic) {
    // Read the runtime-overridden runtimeConfig.iam, not a value captured
    // at build time - see the comment in module.ts's setup() for why.
    if (!config.iam) {
      throw new Error(`nuxt-iam-client: instance "${instanceId}" is static but has no iam config`)
    }
    return config.iam
  }
  if (typeof resolveIamAppCredentials !== 'function') {
    throw new Error(
      `nuxt-iam-client: instance "${instanceId}" is dynamic but no resolveIamAppCredentials(event) server util was found`
    )
  }
  return resolveIamAppCredentials(event)
}

export async function exchangeCode(credentials: IamCredentials, code: string): Promise<TokenResponse> {
  const response = await fetch(`${iamBaseUrl(credentials.url)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: credentials.appId,
      client_secret: credentials.appSecret,
    }),
  })

  if (!response.ok) {
    const error = (await response.json()) as TokenErrorResponse
    iamDebugLog('exchangeCode', 'token exchange failed', { status: response.status, error: error.error, message: error.message })
    throw new Error(`Token exchange failed: ${error.error} — ${error.message}`)
  }

  iamDebugLog('exchangeCode', 'token exchange succeeded', { appId: credentials.appId })
  return (await response.json()) as TokenResponse
}

export async function refreshAccessToken(credentials: IamCredentials, refreshToken: string): Promise<RefreshResponse> {
  const response = await fetch(`${iamBaseUrl(credentials.url)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: credentials.appId,
      client_secret: credentials.appSecret,
    }),
  })

  if (!response.ok) {
    iamDebugLog('refreshAccessToken', 'refresh failed', { status: response.status, appId: credentials.appId })
    throw new Error('Refresh failed')
  }

  iamDebugLog('refreshAccessToken', 'refresh succeeded', { appId: credentials.appId })
  return (await response.json()) as RefreshResponse
}

function rowToSession(row: IamClientSessionRow): Session {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    appId: row.appId,
    metadata: row.metadata ?? undefined,
  }
}

export async function createIamSession(
  event: H3Event,
  instanceId: string,
  data: Omit<Session, 'id'>,
): Promise<Session> {
  const id = randomBytes(32).toString('base64url')
  await getSessionsDb().insert(iamClientSessions).values({
    id,
    instanceId,
    username: data.username,
    email: data.email,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    accessTokenExpiresAt: data.accessTokenExpiresAt,
    appId: data.appId,
    metadata: data.metadata ?? null,
  })
  setCookie(event, sessionCookieName(instanceId), id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  const session: Session = { id, ...data }
  iamDebugLog('createIamSession', 'iam session created', { instanceId, email: data.email, appId: data.appId, expiresAt: data.accessTokenExpiresAt })
  return session
}

export async function setIamSessionMetadata(event: H3Event, instanceId: string, metadata: Record<string, unknown>): Promise<void> {
  const id = getCookie(event, sessionCookieName(instanceId))
  if (!id) return
  const db = getSessionsDb()
  const [row] = await db
    .select()
    .from(iamClientSessions)
    .where(and(eq(iamClientSessions.id, id), eq(iamClientSessions.instanceId, instanceId)))
    .limit(1)
  if (!row) return
  const merged = { ...(row.metadata ?? {}), ...metadata }
  await db.update(iamClientSessions).set({ metadata: merged }).where(eq(iamClientSessions.id, id))
}

export async function getIamSession(event: H3Event, instanceId: string): Promise<Session | null> {
  const id = getCookie(event, sessionCookieName(instanceId))
  if (!id) {
    iamDebugLog('getIamSession', 'no session cookie present', { instanceId })
    return null
  }

  const db = getSessionsDb()
  const [row] = await db
    .select()
    .from(iamClientSessions)
    .where(and(eq(iamClientSessions.id, id), eq(iamClientSessions.instanceId, instanceId)))
    .limit(1)
  if (!row) {
    iamDebugLog('getIamSession', 'session cookie present but no matching session in storage', { instanceId })
    return null
  }

  const session = rowToSession(row)

  if (Date.now() >= session.accessTokenExpiresAt) {
    iamDebugLog('getIamSession', 'access token expired, attempting refresh', { instanceId, email: session.email })
    try {
      const credentials = await resolveIamCredentials(event, instanceId)
      if (!credentials) throw new Error('no credentials resolved for refresh')
      const refreshed = await refreshAccessToken(credentials, session.refreshToken)
      session.accessToken = refreshed.token
      session.refreshToken = refreshed.refresh_token
      session.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000
      await db
        .update(iamClientSessions)
        .set({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          accessTokenExpiresAt: session.accessTokenExpiresAt,
        })
        .where(eq(iamClientSessions.id, id))
      iamDebugLog('getIamSession', 'access token refreshed', { instanceId, email: session.email })
    } catch {
      iamDebugLog('getIamSession', 'refresh failed, destroying session', { instanceId, email: session.email })
      await destroyIamSession(event, instanceId)
      return null
    }
  }

  return session
}

export async function destroyIamSession(event: H3Event, instanceId: string) {
  const id = getCookie(event, sessionCookieName(instanceId))
  if (id) {
    await getSessionsDb().delete(iamClientSessions).where(and(eq(iamClientSessions.id, id), eq(iamClientSessions.instanceId, instanceId)))
  }
  deleteCookie(event, sessionCookieName(instanceId))
  iamDebugLog('destroyIamSession', 'session destroyed', { instanceId, hadSession: Boolean(id) })
}

export function audienceMatches(aud: string | string[], appId: string): boolean {
  if (Array.isArray(aud)) return aud.includes(appId)
  return aud === appId
}
