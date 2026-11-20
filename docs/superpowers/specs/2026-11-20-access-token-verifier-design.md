# Shared access-token verifier — design

**Date:** 2026-11-20. **Branch:** `feat/access-token-verifier`.
**Workspace decisions:** SEC-12 in `web/docs/security/design-changes-proposal.md`; D7 (audience is the app's
resource URI), D8 (`act` tokens), D10–D12; RFC 9068 section 4 and RFC 8725 sections 3.1, 3.8, 3.9, 3.11, 3.12
(`web/docs/security/references/`). Depends on `iam` emitting `typ: at+jwt` (iam branch
`feat/issuer-and-resource-uri`).

## Why

Every application an agent calls must verify `iam` access tokens the same way, and `myteam` must accept
exchanged bearer tokens. Today `nuxt-iam-client` only handles the authorization-code login and sessions; it has
no resource-server verification. The workspace rule is to put shared behavior in `lib/`.

## Requirements

1. `verifyAccessToken(token, options)` returns verified claims or throws `AccessTokenError`. It rejects unless:
   - the token has three parts and a JSON header with `typ` equal to `at+jwt` (RFC 9068; `application/at+jwt`
     also accepted);
   - `alg` is in `options.algorithms` (default `['RS256']`; `none` never allowed), and the JWKS key found by
     `kid` has that algorithm;
   - the signature verifies with a key from the issuer's JWKS;
   - `iss` equals `options.issuer` exactly (trailing slash removed from the option);
   - `aud` (string or array) contains one of `options.audience`;
   - `exp` is in the future and `nbf`/`iat` are not in the future, each allowing `options.clockToleranceSeconds`
     (default 60).
2. Claims returned: `sub`, `aud`, `scopes` (the space-separated `scope` split into an array, `[]` when absent),
   `principalType` (`'agent'` when `principal_type` is `agent`, otherwise `'user'`), `tenantId` (from
   `tenant_id`), `actor` (the `act` claim, if any), `jti`, `exp`, and `raw` (all claims).
3. JWKS: fetched from `options.jwksUri` (default `<issuer>/.well-known/jwks.json`), cached in memory per URI
   for 10 minutes; an unknown `kid` triggers at most one refetch per 30 seconds per URI.
4. `requireAccessToken(event, options)` reads `Authorization: Bearer`, verifies, checks the principal kind
   against `options.principals` (default `['user']`), stores the result on `event.context.accessToken`, and
   returns it. Any failure → 401 with `WWW-Authenticate: Bearer error="invalid_token"` and no detail of
   which check failed in the response; the reason is logged with `iamDebugLog`.
5. Both are auto-imported server utilities (same mechanism as the existing `server/utils`).
6. No permission logic: deciding which route needs which permission stays in each app.
