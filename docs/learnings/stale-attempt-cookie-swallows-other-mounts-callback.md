# A stale attempt cookie in one mount swallowed another mount's callback (2026-10-23)

**Symptom:** a tenant login in `home` (two mounts on one origin: `admin` and `tenant`) completed at
iam but ended on the admin not-authenticated page. `home`'s log showed
`rejecting callback: state mismatch { instanceId: 'admin' }` for a login started by the `tenant` mount.

**Root cause:** every mount registers a global middleware that inspects any request carrying
`code`+`state`. A mount only passed a callback through when it had *no* `iam_attempt_<instanceId>`
cookie. If it had one - e.g. left over from an abandoned admin login (cookies live 10 minutes) -
and the state differed, it failed the callback. The first-registered mount (`admin`) therefore
rejected a callback belonging to the `tenant` mount, which never saw it.

**Fix:** a state that does not match this mount's own attempt is now passed through instead of
failed (`src/runtime/server/middleware/auth.ts`). A session is still only created by the mount whose
own cookie matches the state, and a callback no mount owns creates no session, so the CSRF
protection is unchanged. Covered by `test/callback-middleware.test.ts`.

**Takeaway:** in a multi-mount setup, "not mine" must be decided from this mount's own data and
must never be a terminal failure; only the mount that owns the callback may reject it.
