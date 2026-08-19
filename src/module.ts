import { addImports, addServerHandler, addServerImportsDir, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
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

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-iam-client',
    configKey: 'iamClient',
  },
  defaults: {
    instanceId: 'default',
    authenticatedPath: '/authenticated',
    afterLoginPath: '/dashboard',
    notAuthenticatedPath: '/not-authenticated',
    afterLogoutPath: '/',
    routePrefix: '/api/auth',
    composableAlias: 'useAuth',
  } as ModuleOptions,
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

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
      iam: options.dynamic ? undefined : options.iam,
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

    addServerImportsDir(resolver.resolve('./runtime/server/utils'))

    // Per-mount wrappers: each sets event.context.iamInstanceId to this
    // mount's fixed instanceId before delegating to the shared handler, so
    // the same compiled handler file can be registered at multiple routes
    // (one per mount) and still know which mount it's running for.
    const wrapperFor = (name: string, handlerPath: string) => {
      const template = addTemplate({
        filename: `iam-client-${options.instanceId}-${name}.mjs`,
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
      getContents: () =>
        `import { useAuthImpl } from ${JSON.stringify(resolver.resolve('./runtime/composables/useAuth'))}\n`
        + `export function ${composableAlias}() { return useAuthImpl(${JSON.stringify(options.instanceId)}) }\n`,
    })

    addImports({
      name: composableAlias,
      as: composableAlias,
      from: composableTemplate.dst,
    })
  },
})
