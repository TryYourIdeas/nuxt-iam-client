# Fix Multi-Instance Module Mounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix tenant login (`useTenantAuth is not defined`) by letting `nuxt-iam-client` accept multiple instance configs in one module registration, since Nuxt's module-array dedup silently drops any second `['nuxt-iam-client', {...}]` entry regardless of its options.

**Architecture:** `setup(options, nuxt)` normalizes `options` to an array (`Array.isArray(options) ? options : [options]`), applies defaults manually per entry via a plain `INSTANCE_DEFAULTS` object (not `defineNuxtModule`'s own `defaults` field, whose defu-merge behavior with an array input isn't something to rely on), then runs the existing per-instance setup logic once per entry — all within the single `setup()` call Nuxt actually invokes. `home`'s `nuxt.config.ts` collapses its two separate array entries into one entry holding both instance configs. This repo (`lib/nuxt-iam-client`) and `home` are separate git repositories — Task 1 lands in this repo, Task 2 in `home`, connected via the existing `file:../lib/nuxt-iam-client` symlink dependency (no version bump needed; `home` picks up the fix as soon as it's on this repo's `main`).

**Tech Stack:** Nuxt Kit module API (`@nuxt/kit`), `defu`, Vitest, TypeScript.

---

### Task 1: Fix `nuxt-iam-client`'s module setup (this repo)

**Files:**
- Modify: `src/module.ts`

- [ ] **Step 1: Replace the full file content**

Replace all of `src/module.ts` with:

```typescript
import { addImports, addServerHandler, addServerImportsDir, addServerPlugin, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'
import { iamDebugLog } from './runtime/server/utils/iamDebugLog'

export interface IamCredentials {
  /** Base URL of the `iam` instance, e.g. "https://iam.tryyourideas.com" */
  url: string
  /** app_id registered with iam for this app/environment */
  appId: string
  /** client_secret printed once when the app was registered with iam */
  clientSecret: string
}

export interface ModuleOptions {
  /**
   * Distinguishes this mount's cookies, storage namespace, and runtime
   * config entry from any other mount of this module in the same app.
   * Required — there is no safe default once more than one mount exists.
   */
  instanceId: string
  /**
   * Static credentials for this mount. Required unless `dynamic: true`.
   */
  iam?: IamCredentials
  /**
   * When true, credentials are resolved per request via a
   * `resolveIamAppCredentials(event)` server util the consuming app must
   * define (auto-imported, e.g. in its own `server/utils/`). Use this when
   * one mount serves many logical clients (e.g. one per tenant) instead of
   * one fixed app.
   */
  dynamic?: boolean
  /**
   * Path on this app's own origin that iam redirects back to with
   * ?code=&state=. Must exactly match the authenticated_url registered
   * with iam.
   */
  authenticatedPath?: string
  /** Where to send a visitor who already has a valid session. */
  afterLoginPath?: string
  /** Where to send a visitor after any failed/rejected login. */
  notAuthenticatedPath?: string
  /** Where to send a visitor after logging out. */
  afterLogoutPath?: string
  /**
   * Prefix for the module's three server routes (login/logout/session).
   * Default: '/api/auth'. Set this when the consuming app already owns
   * routes at that prefix (e.g. its own tenant auth).
   */
  routePrefix?: string
  /**
   * Name the auto-imported composable is registered under.
   * Default: 'useAuth'. Set this when the consuming app already has its
   * own `useAuth()` composable.
   */
  composableAlias?: string
}

// Applied manually per instance inside setup(), not via defineNuxtModule's
// own `defaults` field - that field is merged with inline options by Nuxt
// itself *before* setup() runs, and that merge's behavior when the inline
// value is an array (the multi-instance case below) isn't something to
// rely on. Doing it manually here works identically for both the
// single-object and array cases.
const INSTANCE_DEFAULTS: Partial<ModuleOptions> = {
  instanceId: 'default',
  authenticatedPath: '/authenticated',
  afterLoginPath: '/dashboard',
  notAuthenticatedPath: '/not-authenticated',
  afterLogoutPath: '/',
  routePrefix: '/api/auth',
  composableAlias: 'useAuth',
}

export default defineNuxtModule<ModuleOptions | ModuleOptions[]>({
  meta: {
    name: 'nuxt-iam-client',
    configKey: 'iamClient',
  },
  setup(rawOptions, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Nuxt dedupes `modules` array entries by this module's static
    // meta.name, so a second `['nuxt-iam-client', {...}]` entry for a
    // second instance is silently dropped no matter what options it
    // carries - setup() only ever runs once per app. Accepting an array
    // here lets a consumer mount multiple instances (e.g. admin + tenant)
    // through that single entry instead, so there's nothing left to dedupe.
    const instancesInput = Array.isArray(rawOptions) ? rawOptions : [rawOptions]

    addServerImportsDir(resolver.resolve('./runtime/server/utils'))

    for (const instanceInput of instancesInput) {
      const options = defu(instanceInput, INSTANCE_DEFAULTS) as ModuleOptions

      if (!options.instanceId) {
        throw new Error('nuxt-iam-client: `instanceId` module option is required')
      }
      if (!options.dynamic && !options.iam) {
        throw new Error(`nuxt-iam-client: instance "${options.instanceId}" needs \`iam\` credentials unless \`dynamic: true\``)
      }

      const runtimeConfig = nuxt.options.runtimeConfig as Record<string, any>
      runtimeConfig.iamClientInstances = runtimeConfig.iamClientInstances || {}
      runtimeConfig.iamClientInstances[options.instanceId] = {
        dynamic: Boolean(options.dynamic),
      }

      if (!options.dynamic) {
        // Static credentials are kept at the *original*, unprefixed
        // `runtimeConfig.iam` path (not nested under iamClientInstances) so
        // Nitro's env-override still maps it to NUXT_IAM_URL/NUXT_IAM_APP_ID/
        // NUXT_IAM_CLIENT_SECRET at server startup - Nitro derives the
        // override env var name from the exact runtimeConfig path a value
        // lives at, so nesting it under a per-instanceId key (as an earlier
        // version of this module did) silently renamed the expected env var
        // to NUXT_IAM_CLIENT_INSTANCES_<INSTANCEID>_IAM_URL, which nothing
        // sets - the app then falls back to whatever NUXT_IAM_URL happened to
        // be on the machine that ran `nuxt build`, forever, regardless of
        // what the deployed server's real environment says. Only one static
        // instance can rely on this (today: admin) - a second static mount
        // would collide on this same key; dynamic instances (tenant) don't
        // need it, since they resolve credentials from the DB per request.
        runtimeConfig.iam = defu(runtimeConfig.iam, options.iam)
      }

      iamDebugLog('module setup', 'registered iam-client instance at build time (pre runtime-env override)', {
        instanceId: options.instanceId,
        dynamic: Boolean(options.dynamic),
        url: options.iam?.url,
        appId: options.iam?.appId,
      })

      const routePrefix = options.routePrefix ?? '/api/auth'

      runtimeConfig.public.iamClient = runtimeConfig.public.iamClient || {}
      runtimeConfig.public.iamClient[options.instanceId] = defu(runtimeConfig.public.iamClient[options.instanceId], {
        authenticatedPath: options.authenticatedPath,
        afterLoginPath: options.afterLoginPath,
        notAuthenticatedPath: options.notAuthenticatedPath,
        afterLogoutPath: options.afterLogoutPath,
        routePrefix,
      })

      // Session-store migrations + boot plugin: registered once per app even
      // though this loop may run once per instance (e.g. home's admin + tenant
      // instances share one physical iam_client_sessions table) - a second
      // iteration must not re-push the same serverAsset or re-register the
      // same Nitro plugin.
      const nitroOptions = (nuxt.options as unknown as { nitro: Record<string, any> }).nitro || {}
      nitroOptions.serverAssets = nitroOptions.serverAssets || []
      ;(nuxt.options as unknown as { nitro: Record<string, any> }).nitro = nitroOptions
      const alreadyRegistered = nitroOptions.serverAssets.some(
        (asset: { baseName: string }) => asset.baseName === 'nuxtIamClientMigrations',
      )
      if (!alreadyRegistered) {
        nitroOptions.serverAssets.push({
          baseName: 'nuxtIamClientMigrations',
          dir: resolver.resolve('./runtime/server/db/migrations'),
        })
        addServerPlugin(resolver.resolve('./runtime/server/plugins/migrate'))
      }

      // Per-mount wrappers: each sets event.context.iamInstanceId to this
      // mount's fixed instanceId before delegating to the shared handler, so
      // the same compiled handler file can be registered at multiple routes
      // (one per mount) and still know which mount it's running for.
      const wrapperFor = (name: string, handlerPath: string) => {
        const template = addTemplate({
          filename: `iam-client-${options.instanceId}-${name}.mjs`,
          write: true,
          getContents: () =>
            `import handler from ${JSON.stringify(resolver.resolve(handlerPath))}\n`
            + `export default (event) => { event.context.iamInstanceId = ${JSON.stringify(options.instanceId)}; return handler(event) }\n`,
        })
        return template.dst
      }

      addServerHandler({
        middleware: true,
        handler: wrapperFor('middleware', './runtime/server/middleware/auth'),
      })
      addServerHandler({
        route: `${routePrefix}/login`,
        method: 'get',
        handler: wrapperFor('login', './runtime/server/api/auth/login.get'),
      })
      addServerHandler({
        route: `${routePrefix}/logout`,
        method: 'post',
        handler: wrapperFor('logout', './runtime/server/api/auth/logout.post'),
      })
      addServerHandler({
        route: `${routePrefix}/session`,
        method: 'get',
        handler: wrapperFor('session', './runtime/server/api/auth/session.get'),
      })

      const composableAlias = options.composableAlias ?? 'useAuth'
      const composableTemplate = addTemplate({
        filename: `iam-client-${options.instanceId}-composable.mjs`,
        write: true,
        getContents: () =>
          `import { useAuthImpl } from ${JSON.stringify(resolver.resolve('./runtime/composables/useAuth'))}\n`
          + `export function ${composableAlias}() { return useAuthImpl(${JSON.stringify(options.instanceId)}) }\n`,
      })

      addImports({
        name: composableAlias,
        as: composableAlias,
        from: composableTemplate.dst,
      })
    }
  },
})
```

Changes from the current file, summarized: `addServerImportsDir` moved above the loop (it doesn't depend on per-instance `options`, so it should only run once regardless of instance count); everything else wrapped in `for (const instanceInput of instancesInput)`, with `options` now computed via manual `defu(instanceInput, INSTANCE_DEFAULTS)` instead of arriving pre-merged from `defineNuxtModule`'s own `defaults` field (removed); the module's generic type changed from `ModuleOptions` to `ModuleOptions | ModuleOptions[]`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Run the existing test suite**

Run: `npm run test`
Expected: same pass count as before this change — these tests exercise the runtime composable logic (`useAuthImpl`), not `setup()` itself, so none should be affected by this refactor

- [ ] **Step 4: Commit**

```bash
git add src/module.ts
git commit -m "fix: support multiple instances via one module registration

Nuxt dedupes modules array entries by this module's static meta.name,
so a second ['nuxt-iam-client', {...}] entry for a second instance was
silently dropped regardless of its options - setup() only ever ran
once per app. Accepting an array of instance configs in one
registration sidesteps that dedup entirely, since Nuxt only ever sees
one array entry for this module regardless of instance count.

Per docs/superpowers/specs/2026-08-24-multi-instance-single-registration-design.md."
```

---

### Task 2: Update `home`'s config to the new single-entry form (separate repo)

**Files:**
- Modify: `home/nuxt.config.ts`

This task happens in a **different git repository** (`home`, not `lib/nuxt-iam-client`) — use the worktree/plan-execution flow against `home`'s own repo for this task, picking up the Task 1 fix automatically via the existing `file:../lib/nuxt-iam-client` symlink dependency (no version bump or `npm install` needed for the fix itself to take effect, since it's a live symlink — a `.nuxt` rebuild is enough).

- [ ] **Step 1: Collapse the two module entries into one**

In `home/nuxt.config.ts`, change:

```typescript
  modules: [
    '@nuxt/content', '@nuxtjs/mdc', '@nuxt/a11y', '@nuxt/eslint', '@nuxt/scripts', '@nuxt/test-utils', '@nuxt/fonts', '@nuxt/hints', '@comark/nuxt', '@nuxtjs/i18n', 'nuxt-auth-utils', '@nuxtjs/seo', '@nuxt/icon', '@nuxt/image',
    ['nuxt-iam-client', {
      instanceId: 'admin',
      iam: {
        url: process.env.NUXT_IAM_URL || '',
        appId: process.env.NUXT_IAM_APP_ID || '',
        clientSecret: process.env.NUXT_IAM_CLIENT_SECRET || '',
      },
      routePrefix: '/api/admin/auth/iam',
      composableAlias: 'useIamAuth',
      authenticatedPath: '/admin/authenticated',
      afterLoginPath: '/admin/authenticated',
      notAuthenticatedPath: '/admin/not-authenticated',
      afterLogoutPath: '/admin/login',
    }],
    ['nuxt-iam-client', {
      instanceId: 'tenant',
      dynamic: true,
      routePrefix: '/api/auth/iam',
      composableAlias: 'useTenantAuth',
      authenticatedPath: '/authenticated',
      afterLoginPath: '/dashboard',
      notAuthenticatedPath: '/not-authenticated',
      afterLogoutPath: '/login',
    }],
  ],
```

to:

```typescript
  modules: [
    '@nuxt/content', '@nuxtjs/mdc', '@nuxt/a11y', '@nuxt/eslint', '@nuxt/scripts', '@nuxt/test-utils', '@nuxt/fonts', '@nuxt/hints', '@comark/nuxt', '@nuxtjs/i18n', 'nuxt-auth-utils', '@nuxtjs/seo', '@nuxt/icon', '@nuxt/image',
    ['nuxt-iam-client', [
      {
        instanceId: 'admin',
        iam: {
          url: process.env.NUXT_IAM_URL || '',
          appId: process.env.NUXT_IAM_APP_ID || '',
          clientSecret: process.env.NUXT_IAM_CLIENT_SECRET || '',
        },
        routePrefix: '/api/admin/auth/iam',
        composableAlias: 'useIamAuth',
        authenticatedPath: '/admin/authenticated',
        afterLoginPath: '/admin/authenticated',
        notAuthenticatedPath: '/admin/not-authenticated',
        afterLogoutPath: '/admin/login',
      },
      {
        instanceId: 'tenant',
        dynamic: true,
        routePrefix: '/api/auth/iam',
        composableAlias: 'useTenantAuth',
        authenticatedPath: '/authenticated',
        afterLoginPath: '/dashboard',
        notAuthenticatedPath: '/not-authenticated',
        afterLogoutPath: '/login',
      },
    ]],
  ],
```

- [ ] **Step 2: Verify both instances actually get generated in a from-scratch build**

Run (from `home/`): `rm -rf .nuxt && npx nuxi prepare`
Expected: `Types generated in .nuxt.` with no errors

Run: `find .nuxt -iname "*iam-client-tenant*"`
Expected: five files — `iam-client-tenant-middleware.mjs`, `iam-client-tenant-login.mjs`, `iam-client-tenant-logout.mjs`, `iam-client-tenant-session.mjs`, `iam-client-tenant-composable.mjs` (none of these exist today — this is the actual bug being fixed)

Run: `grep useTenantAuth .nuxt/imports.d.ts`
Expected: `export { useTenantAuth } from './iam-client-tenant-composable';`

Run: `find .nuxt -iname "*iam-client-admin*"`
Expected: the same five files, `admin` instead of `tenant` — confirms the admin instance still works exactly as before (no regression)

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: same pass count as `main`'s current state (no test currently exercises the tenant auth composable directly, so this is primarily a build-time verification, not a test-count change)

- [ ] **Step 4: Manual end-to-end verification**

Start the dev server (background, as in prior sessions), copy in a real `.env`, and confirm `/authenticated` no longer throws `useTenantAuth is not defined` — either by driving a real tenant login if credentials allow, or at minimum by confirming the page renders past the point where the composable is called (no 500 error referencing `useTenantAuth`). Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
git add nuxt.config.ts
git commit -m "$(cat <<'EOF'
fix: mount nuxt-iam-client's admin and tenant instances in one registration

The two separate ['nuxt-iam-client', {...}] array entries were never
both actually working - Nuxt dedupes modules array entries by this
module's static meta.name, so the second entry (tenant) was silently
dropped regardless of its options, and useTenantAuth was never
registered. Collapsing both into one entry holding an array of
instance configs (lib/nuxt-iam-client now supports this) fixes it -
verified via a from-scratch build generating both instances' files.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Next steps

None identified — this closes the loop on the bug as reported. If `agent-builder` later adopts `nuxt-iam-client` per the cross-app SSO design, it would use the same single-instance form it already would have used (no multi-instance need there), so this fix doesn't require any follow-up for that.
