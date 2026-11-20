import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type H3Event } from 'h3'
import { beforeEach, describe, expect, it } from 'vitest'
import { requireAccessToken } from '../src/runtime/server/utils/accessToken'
import { resetJwksCacheForTests } from '../src/runtime/server/utils/jwks'
import { AUDIENCE, ISSUER, NOW_S, jwksFetch, token } from './support/tokens'

function eventWith(authorization?: string): { event: H3Event; res: ServerResponse } {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/api/thing'
  if (authorization) req.headers.authorization = authorization
  const res = new ServerResponse(req)
  return { event: createEvent(req, res), res }
}

const baseOptions = () => ({ issuer: ISSUER, audience: AUDIENCE, fetch: jwksFetch(), now: () => NOW_S * 1000 })

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught as { statusCode?: number; message?: string; data?: unknown },
  )
  expect(error).not.toBeNull()
  return error!
}

describe('requireAccessToken', () => {
  beforeEach(() => resetJwksCacheForTests())

  it('rejects a request without a bearer token with 401 and WWW-Authenticate', async () => {
    const { event, res } = eventWith()
    const error = await failureOf(requireAccessToken(event, baseOptions()))
    expect(error.statusCode).toBe(401)
    expect(res.getHeader('www-authenticate')).toBe('Bearer error="invalid_token"')
  })

  it('rejects an invalid token with 401 without revealing which check failed', async () => {
    const { event, res } = eventWith(`Bearer ${token({ iss: 'https://evil.example.com' })}`)
    const error = await failureOf(requireAccessToken(event, baseOptions()))
    expect(error.statusCode).toBe(401)
    expect(res.getHeader('www-authenticate')).toBe('Bearer error="invalid_token"')
    expect(JSON.stringify({ message: error.message, data: error.data })).not.toContain('wrong_issuer')
  })

  it('accepts a valid user token and stores it on the event', async () => {
    const { event } = eventWith(`Bearer ${token()}`)
    const verified = await requireAccessToken(event, baseOptions())
    expect(verified).toMatchObject({ sub: 'alice', principalType: 'user' })
    expect(event.context.accessToken).toEqual(verified)
  })

  it('refuses an agent token on a route that accepts only users (the default)', async () => {
    const { event } = eventWith(`Bearer ${token({ principal_type: 'agent' })}`)
    const error = await failureOf(requireAccessToken(event, baseOptions()))
    expect(error.statusCode).toBe(401)
    expect(event.context.accessToken).toBeUndefined()
  })

  it('accepts an agent token where agents are allowed', async () => {
    const { event } = eventWith(`Bearer ${token({ principal_type: 'agent' })}`)
    await expect(requireAccessToken(event, { ...baseOptions(), principals: ['agent'] })).resolves.toMatchObject({
      principalType: 'agent',
    })
  })
})
