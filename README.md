# nuxt-iam-client

Nuxt module implementing the client side of `iam`'s SSO flow (see
`web/iam/IAM_CLIENT_IMPLEMENTATION.md` for the protocol this implements).
Extracted from `TestIam` so other Nuxt apps in `web/` can adopt the same
`iam` integration without re-implementing it.

## What it provides

- `GET /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`
- Server middleware that handles the `?code=&state=` OAuth callback: state/nonce
  validation, code exchange, `id_token` claim checks (`nonce`/`aud`/`exp`),
  session creation.
- Session storage (Nitro `useStorage`, in-memory by default) with transparent
  refresh-token rotation.
- `useAuth()` composable (auto-imported) — `user`, `status`, `fetchSession()`,
  `logout()`.

## What it does NOT provide

Any actual pages or UI. The consuming app still owns:
- A page at the path registered as `authenticated_url` with `iam` (see
  `authenticatedPath` option below) — this is where the OAuth code lands.
- A page at `notAuthenticatedPath` for failed/rejected logins.
- Wherever `afterLoginPath`/`afterLogoutPath` point.
- Whatever UI shows the signed-in user's data.

## Usage

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-iam-client'],
  iamClient: {
    iam: {
      url: '', // NUXT_IAM_URL
      appId: '', // NUXT_IAM_APP_ID
      clientSecret: '', // NUXT_IAM_CLIENT_SECRET
    },
    // All optional — shown here with their defaults:
    // authenticatedPath: '/authenticated',
    // afterLoginPath: '/dashboard',
    // notAuthenticatedPath: '/not-authenticated',
    // afterLogoutPath: '/',
    // routePrefix: '/api/auth',
    // composableAlias: 'useAuth',
  },
})
```

`iam.url`/`appId`/`clientSecret` are server-only secrets — set them via env
vars (`NUXT_IAM_URL`, `NUXT_IAM_APP_ID`, `NUXT_IAM_CLIENT_SECRET`), never
committed. The four path options are public (client-readable) since they're
just route paths, not secrets.

`routePrefix` and `composableAlias` exist so more than one consuming app (or
an app with its own pre-existing `/api/auth/*` routes and `useAuth()`
composable) can mount this module without collisions — e.g. `home` mounts it
at `routePrefix: '/api/admin/auth/iam'` with `composableAlias: 'useIamAuth'`
to sit alongside its own tenant auth.

```vue
<!-- e.g. pages/authenticated.vue -->
<script setup lang="ts">
const { fetchSession } = useAuth()
const { data: user } = await useAsyncData('auth-session', () => fetchSession())
await navigateTo(user.value ? '/dashboard' : '/not-authenticated')
</script>
```

## Consuming this package

Not published to a registry — add it as a relative `file:` dependency:

```json
{
  "dependencies": {
    "nuxt-iam-client": "file:../lib/nuxt-iam-client"
  }
}
```

## Development

```bash
npm install
npm test         # vitest — pure-function tests (JWT decode, audience matching)
npm run typecheck # tsc --noEmit — covers src/module.ts only
```

`src/runtime/**` isn't typechecked standalone — it depends on ambient
auto-import types (`useRuntimeConfig`, `useStorage`, `defineEventHandler`,
etc.) that only exist inside a real Nuxt app build. It's verified via the
consuming app's own `nuxi typecheck` instead.
