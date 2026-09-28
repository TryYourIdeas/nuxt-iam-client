import { addImports, addServerHandler, addServerImportsDir, addServerPlugin, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'
import { iamDebugLog } from './runtime/server/utils/iamDebugLog'

export interface IamCredentials {
  /** Base URL of the `iam` instance, e.g. "https://iam.tryyourideas.com" */
  url: string
  /** app_id registered with iam for this app/environment */
  appId: string
  /** client_secret printed once when the app was registered with iam */
  appSecret: string
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

export interface MultiInstanceModuleOptions {
  instances: ModuleOptions[]
}

function isMultiInstance(options: ModuleOptions | MultiInstanceModuleOptions): options is MultiInstanceModuleOptions {
  return Array.isArray((options as MultiInstanceModuleOptions).instances)
}

export default defineNuxtModule<ModuleOptions | MultiInstanceModuleOptions>({
  meta: {
    name: 'nuxt-iam-client',
    configKey: 'iamClient',
  },
  setup(rawOptions, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Nuxt dedupes `modules` array entries by this module's static
    // meta.name, so a second `['nuxt-iam-client', {...}]` entry for a
    // second instance is silently dropped no matter what options it
    // carries - setup() only ever runs once per app. Accepting a
    // `{ instances: [...] }` options shape here lets a consumer mount
    // multiple instances (e.g. admin + tenant) through that single entry
    // instead, so there's nothing left to dedupe.
    //
    // This must be an object with an `instances` array property, not a
    // bare array passed directly as the module's inline options - Nuxt's
    // own options-merge step runs `defu(inlineOptions, ..., {})` on
    // whatever is passed *before* setup() ever sees it, and defu collapses
    // a bare array merged against a plain object down to `{}`, silently
    // destroying it. A plain object survives that merge untouched.
    const instancesInput = isMultiInstance(rawOptions) ? rawOptions.instances : [rawOptions]

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
        // NUXT_IAM_APP_SECRET at server startup - Nitro derives the
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
