# User Guide / Manual

Step-by-step guide to integrating `nuxt-iam-client` into a Nuxt app in this
workspace.

## 1. Register the app with `iam`

Before writing any code, the consuming app must be registered as a client
application with the `iam` instance it will authenticate against. This
registration produces the `app_id` and `client_secret` you'll use as
`NUXT_IAM_APP_ID`/`NUXT_IAM_CLIENT_SECRET`, and requires an
`authenticated_url` — the exact path on your app's own origin that `iam`
redirects back to. This must match the `authenticatedPath` option
(default `/authenticated`) exactly.

## 2. Install the dependency

Add the module as a relative `file:` dependency (not published to a
registry):

```json
{
  "dependencies": {
    "nuxt-iam-client": "file:../lib/nuxt-iam-client"
  }
}
```

```bash
npm install
```

## 3. Configure the module

Add the module and its config to `nuxt.config.ts`, and set the required
secrets in `.env`. See `docs/user-guides/config.md` for the full option
reference, including multi-mount and dynamic-credential setups.

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
  },
})
```

```
# .env
NUXT_IAM_URL=https://iam.tryyourideas.com
NUXT_IAM_APP_ID=...
NUXT_IAM_CLIENT_SECRET=...
DATABASE_URL=postgres://user:pass@localhost:5432/yourdb
```

`DATABASE_URL` must point at a Postgres 18 database the app already uses (or
a dedicated one) — the module creates and migrates its own
`iam_client_sessions` table there automatically on first request.

## 4. Build the pages the module expects the app to own

The module handles routes and session logic but not UI. At minimum, create:

### `authenticatedPath` (default `/authenticated`)

This is where `iam` redirects back to after login. The module's middleware
intercepts the `?code=&state=` query params on this exact path before the
page renders, completes the token exchange, and (on success) redirects back
to this same path with the query params stripped and a session cookie set.
The page itself should read the resulting session and route the visitor
onward:

```vue
<!-- pages/authenticated.vue -->
<script setup lang="ts">
const { fetchSession } = useAuth()
const { data: user } = await useAsyncData('auth-session', () => fetchSession())
await navigateTo(user.value ? '/dashboard' : '/not-authenticated')
</script>
```

### `notAuthenticatedPath` (default `/not-authenticated`)

Shown when login fails or is rejected (state mismatch, expired token, no
credentials resolved, etc.). A simple static page is enough:

```vue
<!-- pages/not-authenticated.vue -->
<template>
  <div>
    <h1>Sign-in failed</h1>
    <NuxtLink to="/api/auth/login">Try again</NuxtLink>
  </div>
</template>
```

### Wherever `afterLoginPath`/`afterLogoutPath` point

`afterLoginPath` (default `/dashboard`) is where `GET /login` sends a
visitor who already has a valid session, skipping the `iam` round-trip.
`afterLogoutPath` (default `/`) is where `logout()` navigates after clearing
the session. Both just need to be real pages in the app.

## 5. Add sign-in / sign-out UI

Anywhere in the app:

```vue
<script setup lang="ts">
const { user, status, logout } = useAuth()
</script>

<template>
  <div v-if="status === 'authenticated'">
    Signed in as {{ user?.email }}
    <button @click="logout">Sign out</button>
  </div>
  <a v-else href="/api/auth/login">Sign in</a>
</template>
```

Note the sign-in link is a plain `<a>` to the server route
(`{routePrefix}/login`), not a `navigateTo()` call — it needs to be a full
page navigation so the server middleware can set the attempt cookie and
issue the redirect to `iam`.

## 6. Verify the flow locally

1. Start the app (`npm run dev` from the consuming app's directory).
2. Visit the sign-in link. Confirm redirect to the `iam` instance's
   authorization page.
3. Complete login on `iam`. Confirm redirect back to `authenticatedPath`,
   then onward to `afterLoginPath`.
4. Refresh the page — `useAuth().user` should still be populated without a
   fresh `iam` round-trip (session cookie + Postgres row persist it).
5. Click sign-out. Confirm redirect to `afterLogoutPath` and that
   `useAuth().status` becomes `'unauthenticated'`.
6. Set `NUXT_ADD_DEBUG_LOGS=true` and repeat the flow if you need to trace
   what's happening server-side — every step (`login`, `callback`,
   `exchangeCode`, `getIamSession`, `refreshAccessToken`, `logout`) logs to
   the console under `[debug:iam-client:<scope>]`.

## Adding a second mount (e.g. admin + tenant SSO in the same app)

If the app needs more than one independent `iam` integration side by side
(distinct credentials, routes, and composable), see the "Multiple mounts"
section of `docs/user-guides/config.md` — register a single module entry
with an `instances` array rather than repeating the module in the `modules`
array (Nuxt silently drops a second entry with the same module name).

## Troubleshooting

- **`useAuth().fetchSession()` always returns `null`, but a server-side
  check of the session works fine**: if a non-default `routePrefix` is set,
  make sure the app hasn't accidentally shadowed the module's session route
  with one of its own at the same path — see
  `docs/learnings/route-prefix-hardcoded-in-composable.md` for a real
  instance of this class of bug.
- **`nuxt-iam-client: instance "..." needs iam credentials unless
  dynamic: true`**: the `iam` option is missing for a static instance —
  either supply `iam: { url, appId, clientSecret }` or set `dynamic: true`
  and define `resolveIamAppCredentials(event)`.
- **Login redirects to `notAuthenticatedPath` immediately**: enable
  `NUXT_ADD_DEBUG_LOGS=true` and check the `[debug:iam-client:callback]`
  log line — it names the exact rejection reason (state mismatch, nonce
  mismatch, audience mismatch, expired token, or a thrown error during code
  exchange).
