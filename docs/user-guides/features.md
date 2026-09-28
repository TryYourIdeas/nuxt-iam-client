# Features

`nuxt-iam-client` is a Nuxt module implementing the client side of `iam`'s
SSO flow (see `web/iam/docs/user-guides/IAM_CLIENT_IMPLEMENTATION.md` for the protocol it
implements). It was extracted from `TestIam` so other Nuxt apps in `web/`
can adopt the same `iam` integration without re-implementing it.

## What it provides

- **Server routes** (auto-registered under `routePrefix`, default `/api/auth`):
  - `GET /login` — starts the OAuth flow by redirecting to `iam`'s
    authorization endpoint, or skips straight to `afterLoginPath` if a valid
    session already exists.
  - `POST /logout` — destroys the current session and redirects to
    `afterLogoutPath`.
  - `GET /session` — returns `{ user: { username, email } | null }` for the
    current visitor.
- **Callback middleware** that intercepts the `?code=&state=` redirect `iam`
  sends back to `authenticatedPath`:
  - Validates the `state`/`nonce` pair against the attempt cookie set at
    login time (CSRF/replay protection).
  - Exchanges the authorization `code` for tokens.
  - Validates the returned `id_token`'s claims: `nonce` matches the login
    attempt, `aud` matches the resolved app id, and `exp` hasn't passed.
  - Creates a session row and session cookie on success; redirects to
    `notAuthenticatedPath` on any failure (state mismatch, expired token,
    failed exchange, etc.).
- **Session storage** in a Postgres table the module manages itself
  (`iam_client_sessions`), with:
  - Automatic migration on first request — no manual migration step in the
    consuming app.
  - Transparent access-token refresh: an expired access token is refreshed
    against `iam` using the stored refresh token the next time the session
    is read; a failed refresh destroys the session and the caller sees
    `user: null`.
  - Multi-mount support: sessions from every mount in the same app (e.g. two
    `instanceId`s) share one physical table, distinguished by an
    `instance_id` column.
  - A `setIamSessionMetadata(event, instanceId, metadata)` server util to
    attach app-specific metadata (e.g. a role or tenant id looked up after
    login) to the session, merged into whatever is already stored.
- **`useAuth()` composable** (auto-imported; name configurable via
  `composableAlias`) exposing:
  - `user` — a reactive `AuthUser | null` (`{ username, email }`).
  - `status` — computed `'authenticated' | 'unauthenticated'`.
  - `fetchSession()` — fetches `/session` and updates `user`.
  - `logout()` — calls `/logout`, clears `user`, and navigates to
    `afterLogoutPath`.
- **Multiple mounts from one module registration** — an app can register
  more than one independent `iam` integration (e.g. an `admin` SSO instance
  and a per-tenant `dynamic` instance) by passing `{ instances: [...] }`
  instead of a single options object, each with its own routes, composable
  name, and cookie namespace. See `docs/user-guides/config.md`.
- **Dynamic credential resolution** — an instance can resolve its
  `{ url, appId, clientSecret }` per request instead of at build time, via a
  `resolveIamAppCredentials(event)` util the consuming app defines. Useful
  for one mount serving many logical clients (e.g. one per tenant).
- **Gated diagnostic logging** — every step of the login/callback/refresh
  flow logs via `iamDebugLog`, enabled by setting
  `NUXT_ADD_DEBUG_LOGS=true`; silent otherwise.

## What it does NOT provide

Any actual pages or UI. The consuming app still owns:
- A page at the path registered as `authenticated_url` with `iam` (see
  `authenticatedPath` in `docs/user-guides/config.md`) — this is where the
  OAuth code lands and `fetchSession()` is typically called.
- A page at `notAuthenticatedPath` for failed/rejected logins.
- Wherever `afterLoginPath`/`afterLogoutPath` point.
- Whatever UI shows the signed-in user's data.
- The `resolveIamAppCredentials(event)` util, when using `dynamic: true`.

## Sequence: login flow

```mermaid
sequenceDiagram
    participant Browser
    participant App as Consuming App
    participant Mod as nuxt-iam-client
    participant IAM as iam

    Browser->>App: GET {routePrefix}/login
    App->>Mod: handled by login.get
    Mod->>Mod: resolve credentials, generate state/nonce
    Mod->>Browser: set attempt cookie, redirect to iam /auth
    Browser->>IAM: GET /auth?app_id=&state=&nonce=
    IAM->>Browser: redirect to authenticatedPath?code=&state=
    Browser->>App: GET authenticatedPath?code=&state=
    App->>Mod: callback middleware intercepts
    Mod->>Mod: validate state against attempt cookie
    Mod->>IAM: POST /token (exchange code)
    IAM-->>Mod: id_token, access token, refresh token
    Mod->>Mod: validate id_token claims (nonce/aud/exp)
    Mod->>Mod: create session row + session cookie
    Mod->>Browser: redirect to authenticatedPath (session now active)
    Browser->>App: page calls useAuth().fetchSession()
    App->>Mod: GET {routePrefix}/session
    Mod-->>App: { user }
```

## Sequence: session refresh

```mermaid
sequenceDiagram
    participant App as Consuming App
    participant Mod as nuxt-iam-client
    participant IAM as iam
    participant DB as Postgres (iam_client_sessions)

    App->>Mod: getIamSession(event, instanceId)
    Mod->>DB: read session row by cookie id
    alt access token expired
        Mod->>IAM: POST /token (refresh_token grant)
        IAM-->>Mod: new access + refresh token
        Mod->>DB: update session row
    else refresh fails
        Mod->>DB: delete session row
        Mod-->>App: null (session destroyed)
    end
    Mod-->>App: session
```
