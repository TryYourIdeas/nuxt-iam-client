# Shared access-token verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Nuxt app in the workspace one tested way to verify `iam` access tokens on API routes.

**Architecture:** A JWKS cache (`jwks.ts`) and a pure verifier (`accessToken.ts`) built on `node:crypto` (`createPublicKey({ format: 'jwk' })`, `createVerify`), no new dependency. An h3 guard wraps it for routes. All three live in `src/runtime/server/utils/`, which the module already auto-imports.

**Tech Stack:** TypeScript, `node:crypto`, h3, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-11-20-access-token-verifier-design.md`

## Global Constraints

- Accepted `typ`: `at+jwt` or `application/at+jwt` (case-insensitive).
- Default algorithms: `['RS256']`; `none` is rejected even if listed.
- Default clock tolerance: 60 seconds. JWKS cache TTL: 600 seconds. Minimum interval between refetches for an unknown `kid`: 30 seconds.
- Failure responses: status 401, header `WWW-Authenticate: Bearer error="invalid_token"`, body without the failing check.
- No new runtime dependency.

## Review Focus

- A valid token whose `kid` is not in the cached JWKS (key just rotated) must succeed after one refetch, while a flood of unknown `kid`s must not refetch more than once per 30 seconds — Task 1.
- An ID token (header `typ: JWT`) presented as a bearer token must be rejected even though its signature is valid — Task 2.
- `iss` with and without a trailing slash in the option must both match `https://iam.example.com` tokens — Task 2.
- A token signed with an algorithm not in the allowlist, or with `alg: none`, must be rejected before any key lookup — Task 2.
- An agent token on a route that accepts only users (the default) must get 401, not pass — Task 3.

---

### Task 1: JWKS cache

**Files:**
- Create: `src/runtime/server/utils/jwks.ts`, `test/jwks.test.ts`

**Interfaces:**
- Produces: `getJwk(jwksUri: string, kid: string, deps?: { fetch?: typeof fetch; now?: () => number }): Promise<JsonWebKey | null>` and `resetJwksCacheForTests(): void`.

- [ ] **Step 1: Failing tests** (inject `fetch` and `now`):
  - first call fetches and returns the key with that `kid`;
  - a second call within 600 s does not fetch again;
  - after 600 s it refetches;
  - unknown `kid`: one refetch, then `null`; another unknown `kid` within 30 s does not refetch;
  - a key added on refetch (rotation) is found;
  - a failed fetch (non-200 or network error) returns `null` and does not poison the cache.
- [ ] **Step 2:** `npx vitest run test/jwks.test.ts` — FAIL.
- [ ] **Step 3:** Implement a `Map<jwksUri, { keys, fetchedAt, lastMissRefetchAt }>`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat: JWKS cache for access-token verification`.

### Task 2: `verifyAccessToken`

**Files:**
- Create: `src/runtime/server/utils/accessToken.ts`, `test/access-token.test.ts`

**Interfaces:**
- Consumes: `getJwk` (Task 1).
- Produces:
  - `interface VerifyAccessTokenOptions { issuer: string; audience: string | string[]; jwksUri?: string; algorithms?: string[]; clockToleranceSeconds?: number; fetch?: typeof fetch; now?: () => number }`
  - `interface VerifiedAccessToken { sub: string; aud: string[]; scopes: string[]; principalType: 'user' | 'agent'; tenantId?: string; actor?: Record<string, unknown>; jti?: string; exp: number; raw: Record<string, unknown> }`
  - `class AccessTokenError extends Error { reason: string }`
  - `verifyAccessToken(token: string, options: VerifyAccessTokenOptions): Promise<VerifiedAccessToken>`

- [ ] **Step 1: Failing tests** — generate an RSA key pair in the test, serve its public JWK from an injected `fetch`, and sign tokens in a test helper. One test per rule, each expecting `AccessTokenError` with a distinct `reason`:
  - valid token → resolves with `sub`, `aud` as array, `scopes: ['openid', 'email']`, `principalType: 'user'`;
  - `principal_type: 'agent'` → `principalType: 'agent'`; `act: { sub: 'flow-engine' }` → `actor`;
  - `typ: 'JWT'` → `wrong_type`; `application/at+jwt` accepted;
  - `alg: 'none'` and `alg: 'HS256'` → `alg_not_allowed`;
  - unknown `kid` → `unknown_key`; tampered payload → `bad_signature`;
  - `iss` mismatch → `wrong_issuer`; option `issuer: 'https://iam.example.com/'` matches `iss: 'https://iam.example.com'`;
  - `aud` not containing the audience → `wrong_audience`; array `aud` containing it → accepted;
  - `exp` 61 s ago → `expired`; 59 s ago → accepted; `nbf` 120 s ahead → `not_yet_valid`;
  - malformed token (2 parts, bad base64, non-JSON header) → `malformed`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement in the order: shape, header `typ`/`alg`, key, signature, claims. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat: verifyAccessToken for iam access tokens (RFC 9068)`.

### Task 3: `requireAccessToken` route guard

**Files:**
- Modify: `src/runtime/server/utils/accessToken.ts`
- Create: `test/require-access-token.test.ts`

**Interfaces:**
- Produces: `requireAccessToken(event: H3Event, options: VerifyAccessTokenOptions & { principals?: Array<'user' | 'agent'> }): Promise<VerifiedAccessToken>`; sets `event.context.accessToken`.

- [ ] **Step 1: Failing tests** (build an h3 event with `createEvent` from a mock request, or the pattern in `test/callback-middleware.test.ts`):
  - no `Authorization` header → 401 with `WWW-Authenticate: Bearer error="invalid_token"`;
  - invalid token → 401, response body does not contain the `reason`;
  - valid user token, default principals → returns claims and sets `event.context.accessToken`;
  - valid agent token, default principals → 401; with `principals: ['agent']` → accepted.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement; log the reason with `iamDebugLog('accessToken', …)`. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** `feat: requireAccessToken route guard`.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md` (new "Verifying access tokens on API routes" section with a route example), `docs/user-guides/*` as present, `docs/pending-tasks.md` (adoption by `myteam` and agent-facing apps)

- [ ] **Step 1:** Update the documents.
- [ ] **Step 2:** `npm test` and `npm run typecheck` — PASS.
- [ ] **Step 3: Commit** `docs: access-token verification`.
