# Server-side redirects ignored the consuming app's `app.baseURL` (2026-10-23)

**Symptom:** `myteam` is served behind nginx at `https://<tenant>.tryyourideas.com/myteam/` (Nuxt
`app.baseURL = '/myteam/'`). A rejected SSO callback redirected to `/not-authenticated`, and an
already-logged-in `GET <routePrefix>/login` redirected to `afterLoginPath` - both on the host root,
i.e. into `home`, not `myteam`.

**Root cause:** the module's `sendRedirect()` calls (`middleware/auth.ts` `fail()`, `login.get.ts`)
sent the configured path verbatim. Nuxt prefixes `navigateTo()`/`$fetch()` with `app.baseURL`
automatically, but a raw h3 `sendRedirect` is not a router call and gets no prefix. The success
redirect (`url.pathname`) was already correct because it reuses the request's own path.

**Fix:** `withAppBaseURL(event, path)` in `server/utils/auth.ts` prefixes root-relative targets with
`useRuntimeConfig().app.baseURL`, leaving already-prefixed, external and protocol-relative targets
alone. Client-side `useAuth()` needed no change (`$fetch` and `navigateTo` are base-aware).

**Takeaway:** any server-side redirect to an app-relative path must go through `withAppBaseURL`.
