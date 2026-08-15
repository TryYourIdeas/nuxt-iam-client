# Learnings — `routePrefix` was only wired into server route registration, not the client composable

## `useAuth().fetchSession()`/`logout()` silently hit the wrong endpoint for any consumer using a non-default `routePrefix` (found 2026-08-15, in `home`'s admin SSO integration)

**Context**: `routePrefix` and `composableAlias` were added to `ModuleOptions`
so more than one app (or an app with pre-existing routes/composables at the
default names) can mount this module without collisions — see
`ADR-admin-sso-via-iam.md` in `web/docs/architecture/adrs/` and `home`'s
`docs/superpowers/specs/2026-08-14-admin-sso-design.md`. `home` mounts the
module with `routePrefix: '/api/admin/auth/iam'` because its own tenant auth
already owns `/api/auth/*`.

**Symptom**: Everything *looked* like it worked — login redirected through
`iam` correctly, and `home`'s admin gate (accept/reject based on
`ADMIN_EMAIL`) worked correctly too. The one thing broken: a page that called
`useIamAuth().fetchSession()` to read the authenticated identity's email
always got `null` back, with no error anywhere.

**Root cause**: `module.ts`'s `setup()` was updated to build server route
paths from `routePrefix` (`` addServerHandler({ route: `${routePrefix}/session`, ... }) ``),
but `src/runtime/composables/useAuth.ts`'s `fetchSession()`/`logout()` still
had `/api/auth/session` and `/api/auth/logout` **hardcoded** — nobody
updated the composable when `routePrefix` was introduced, and nothing
caught it: the module registered its *real* session route at
`/api/admin/auth/iam/session` in `home`, so the composable's hardcoded
`fetch('/api/auth/session')` call landed on whatever `home` already had
mounted at that exact path — in this case `home`'s own **tenant** session
endpoint, a completely unrelated feature that also happens to respond with
`200 { user: null }` for an unauthenticated visitor. Same response shape
(`{ user }`), silently wrong data, no thrown error, nothing to notice in
logs.

**Why the admin gate still worked correctly despite this**: `home`'s
`ADMIN_EMAIL` accept/reject decision (`requireAdminSession` /
`getIamSession`) is a *server-side util* auto-imported directly from
`src/runtime/server/utils/auth.ts` — it reads the `iam_session` cookie from
Nitro storage directly, never goes through this composable or any HTTP
route at all. Only client code that calls `useAuth()`'s
`fetchSession()`/`logout()` is affected.

**Fix**: expose `routePrefix` via the module's public runtime config
(`runtimeConfig.public.iamClient.routePrefix`) alongside the existing path
options, and build the composable's fetch URLs from
`` `${config.public.iamClient.routePrefix}/session` `` /
`` `${config.public.iamClient.routePrefix}/logout` `` instead of hardcoding
them. Covered by `test/use-auth.test.ts`, which stubs the Nuxt auto-imports
(`useRuntimeConfig`, `useState`, `computed`, `useRequestFetch`, `$fetch`,
`navigateTo`) this composable depends on and asserts the exact URL called —
this is the test that would have caught the original bug immediately, and
didn't exist before this was found in a real deployed app.

**Takeaway for the next `routePrefix`-style option** (e.g. when a tenant
`iam` integration is built, likely reusing this same module): grep the
*whole* `src/runtime/` tree for any hardcoded path this option is meant to
control, not just the file you're actively editing — `module.ts`'s
`setup()` and the composables/routes it wires up are separate files that
can drift out of sync with no compile-time signal. A route-registration-only
test (confirming `addServerHandler` gets the right path) would not have
caught this — the bug was specifically in a *different* file consuming a
*different* copy of the same logical value. Add or update a runtime test
for every file that reads a module option, not just the file that sets it.
