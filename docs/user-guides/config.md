# Configuration

`nuxt-iam-client` is configured under the `iamClient` key in `nuxt.config.ts`
(the module's `configKey`). It supports two shapes: a single mount, or
multiple mounts registered through one module entry.

## Consuming the package

Not published to a registry — add it as a relative `file:` dependency in the
consuming app's `package.json`:

```json
{
  "dependencies": {
    "nuxt-iam-client": "file:../lib/nuxt-iam-client"
  }
}
```

Then register it in `nuxt.config.ts`:

```ts
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

## Options

| Option | Required | Default | Notes |
|---|---|---|---|
| `instanceId` | No | `'default'` | Distinguishes this mount's cookies, storage namespace, and runtime config entry from any other mount in the same app. Set it explicitly once a second mount exists. |
| `iam` | Yes, unless `dynamic: true` | — | `{ url, appId, clientSecret }` — the `iam` instance and app registration this mount authenticates against. |
| `dynamic` | No | `false` | When `true`, credentials are resolved per request via a `resolveIamAppCredentials(event)` server util the consuming app must define (auto-imported, e.g. from its own `server/utils/`). Use this when one mount serves many logical clients (e.g. one per tenant) instead of one fixed app. |
| `authenticatedPath` | No | `/authenticated` | Path on this app's own origin that `iam` redirects back to with `?code=&state=`. Must exactly match the `authenticated_url` registered with `iam`. |
| `afterLoginPath` | No | `/dashboard` | Where to send a visitor who already has a valid session. |
| `notAuthenticatedPath` | No | `/not-authenticated` | Where to send a visitor after any failed/rejected login. |
| `afterLogoutPath` | No | `/` | Where to send a visitor after logging out. |
| `routePrefix` | No | `/api/auth` | Prefix for the module's three server routes (login/logout/session). Set this when the consuming app already owns routes at that prefix (e.g. its own tenant auth). |
| `composableAlias` | No | `useAuth` | Name the auto-imported composable is registered under. Set this when the consuming app already has its own `useAuth()` composable. |

`iam.url`/`appId`/`clientSecret` are server-only secrets — set them via
environment variables (`NUXT_IAM_URL`, `NUXT_IAM_APP_ID`,
`NUXT_IAM_CLIENT_SECRET`) in a `.env` file, never committed. Nitro maps them
onto `runtimeConfig.iam.*` at server startup because that's the exact
`runtimeConfig` path the static-credentials value lives at — this mapping
only works for one static instance per app (see "Multiple mounts" below).
The four path options plus `routePrefix`/`composableAlias`/`instanceId` are
public (client-readable), since they're just route paths and names, not
secrets.

### Example `.env`

```
NUXT_IAM_URL=https://iam.tryyourideas.com
NUXT_IAM_APP_ID=your-app-id
NUXT_IAM_CLIENT_SECRET=your-client-secret
DATABASE_URL=postgres://user:pass@localhost:5432/yourdb
NUXT_ADD_DEBUG_LOGS=false
```

`DATABASE_URL` is read directly from `process.env` (not threaded through
`runtimeConfig`) by the module's own session store — it's the same Postgres
database the consuming app already uses elsewhere in this workspace. The
module manages its own table (`iam_client_sessions`) and runs its own
Drizzle migration automatically on first request; no manual migration step
is required.

## Full single-mount example

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

## Multiple mounts (one module entry, several instances)

Nuxt dedupes `modules` array entries by the module's static name, so a
second `['nuxt-iam-client', {...}]` entry is silently dropped no matter what
options it carries. To mount the module more than once in the same app
(e.g. an `admin` SSO instance alongside a per-tenant `tenant` instance),
register a single entry with an `instances` array instead:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    ['nuxt-iam-client', {
      instances: [
        {
          instanceId: 'admin',
          iam: {
            url: '', // NUXT_IAM_URL
            appId: '', // NUXT_IAM_APP_ID
            clientSecret: '', // NUXT_IAM_CLIENT_SECRET
          },
          routePrefix: '/api/admin/auth/iam',
          composableAlias: 'useIamAuth',
        },
        {
          instanceId: 'tenant',
          dynamic: true, // resolves credentials per request, see below
          routePrefix: '/api/tenant/auth/iam',
          composableAlias: 'useTenantAuth',
        },
      ],
    }],
  ],
})
```

Only one *static* instance per app can rely on the `NUXT_IAM_URL`/
`NUXT_IAM_APP_ID`/`NUXT_IAM_CLIENT_SECRET` env-var mapping described above —
a second static mount would collide on the same `runtimeConfig.iam` key.
Use `dynamic: true` for any additional mount.

### Dynamic credentials

When `dynamic: true`, define a `resolveIamAppCredentials(event)` server
util in the consuming app (e.g. `server/utils/resolveIamAppCredentials.ts`)
that returns `{ url, appId, clientSecret }` for the current request — for
example, looked up by tenant subdomain:

```ts
// server/utils/resolveIamAppCredentials.ts
export async function resolveIamAppCredentials(event: H3Event) {
  const tenant = await getTenantForRequest(event)
  return {
    url: tenant.iamUrl,
    appId: tenant.iamAppId,
    clientSecret: tenant.iamClientSecret,
  }
}
```

This function is auto-imported into the same Nitro build as the module's
own server utils, so no explicit import is needed.

## `routePrefix` / `composableAlias` and collisions

These two options exist so more than one consuming app — or an app with its
own pre-existing `/api/auth/*` routes and `useAuth()` composable — can mount
this module without collisions. For example, `home` mounts its admin
instance at `routePrefix: '/api/admin/auth/iam'` with
`composableAlias: 'useIamAuth'` to sit alongside its own tenant auth at the
default `/api/auth/*` paths.

Every place that consumes a module option that varies per instance (routes,
the composable, session cookies) reads the resolved value for that
instance — there is no hardcoded default left in `src/runtime/**`. See
`docs/learnings/route-prefix-hardcoded-in-composable.md` for the bug this
guards against if a new per-instance option is ever added.
