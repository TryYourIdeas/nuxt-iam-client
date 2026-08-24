# Design: Fix multi-instance mounting (single registration, not repeated array entries)

Status: Draft — approved via brainstorming session, not yet implemented.
Date: 2026-08-24

## Context

`home` mounts this module twice in its `nuxt.config.ts` — once as `admin`,
once as `tenant` — using Nuxt's `[name, options]` module-array tuple form,
one entry per instance. This has never actually worked: Nuxt's module
system dedupes entries in the `modules` array by the module's static
`meta.name` (here, the literal string `'nuxt-iam-client'`, identical for
both entries), so only the **first** matching entry's `setup()` ever runs.
The second is silently skipped — no error, no warning. In `home`'s case
this means the `tenant` instance's server routes, session-store namespace,
and `useTenantAuth` composable were never actually registered, breaking
tenant login (`useTenantAuth is not defined` on `/authenticated`).

Confirmed via a from-scratch build that this reproduces identically
regardless of `@nuxt/kit` patch version — it is not a version regression,
it is a design flaw in how multi-instance mounting was originally set up.
`src/module.ts` already contains an "already registered" idempotency guard
around the shared session-store migration asset (see the comment there),
which shows the original design anticipated `setup()` running more than
once per app — that assumption was wrong; Nuxt's dedup means it runs at
most once total, no matter how many array entries reference it.

## Decision

### 1. Accept an array of instance configs in one module registration

`setup(options, nuxt)` now accepts either a single `ModuleOptions` object
(today's shape, for single-mount consumers) **or** an array of them (new,
for multi-mount consumers). It normalizes with
`const instances = Array.isArray(options) ? options : [options]`, applies
defaults to each entry manually via `defu(entry, INSTANCE_DEFAULTS)` (see
Decision 2 for why manually, not via `defineNuxtModule`'s own `defaults`
field), then runs the existing per-instance setup logic — the `if
(!options.instanceId) throw`, the routes, the composable, the runtime
config — once per entry, all within this single `setup()` call. Since
Nuxt's array-level dedup only ever sees **one** `modules` array entry for
this module (regardless of how many instances are inside it), there is
nothing left for it to collide with.

The idempotency guard around the shared session-store migration asset
(`nitroOptions.serverAssets`) stays — it's now what prevents that one
asset from being pushed multiple times across the instances in the loop,
which is exactly the scenario it was originally guarding against, just
reached a different way.

### 2. Apply defaults manually, not via `defineNuxtModule`'s `defaults` field

`defineNuxtModule`'s own `defaults` option is merged with inline options
via `defu` *before* `setup()` is ever called, as part of Nuxt's own
`getOptions()` step. That merge is designed for a single options object,
and its behavior when the inline value is an *array* isn't something to
rely on. To avoid that uncertainty entirely, `defaults` is removed from
the `defineNuxtModule({...})` call; the same default values move to a
plain exported `INSTANCE_DEFAULTS` object, applied manually per-instance
inside `setup()` after the array/single-object normalization in Decision 1.
Single-object consumers (see Decision 3) are unaffected — they still get
defaults applied, just via this module's own manual step instead of
Nuxt's built-in one.

### 3. Zero API change for existing single-instance consumers

`TestIam` (the only other current consumer, via the top-level `iamClient:
{...}` config key rather than an inline array-tuple option) requires no
change. Its config arrives at `setup()` as a single plain object;
`Array.isArray()` on it is `false`, so it takes the exact same code path
it always has, just reached through the new normalization step instead of
directly.

### 4. `home`'s config changes from two array entries to one

```typescript
// Before (broken — second entry silently dropped):
modules: [
  ['nuxt-iam-client', { instanceId: 'admin', ... }],
  ['nuxt-iam-client', { instanceId: 'tenant', ... }],
]

// After:
modules: [
  ['nuxt-iam-client', [
    { instanceId: 'admin', ... },
    { instanceId: 'tenant', ... },
  ]],
]
```

## Verification

No existing test builds a real Nuxt app to exercise module registration —
`test/*.test.ts` covers the runtime composable logic, not `setup()`
itself. Verification here is a from-scratch Nuxt build in an isolated
`home` worktree: confirm `.nuxt/iam-client-tenant-*.mjs` templates and the
`useTenantAuth` entry in `.nuxt/imports.d.ts` actually get generated
(they don't today), then confirm the full tenant login round-trip no
longer throws `useTenantAuth is not defined`.

## Explicitly out of scope

- Changing how `agent-builder` or any other future consumer would mount
  multiple instances — this fix makes that possible but doesn't add a
  second consumer of the pattern.
- A `{ instances: [...] }` wrapper-object shape was considered and
  rejected in favor of a bare array — confirmed with the user, no
  functional difference, bare array is simpler.
