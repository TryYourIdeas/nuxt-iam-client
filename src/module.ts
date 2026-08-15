import { addImports, addServerHandler, addServerImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

export interface IamCredentials {
  /** Base URL of the `iam` instance, e.g. "https://iam.tryyourideas.com" */
  url: string
  /** app_id registered with iam for this app/environment */
  appId: string
  /** client_secret printed once when the app was registered with iam */
  clientSecret: string
}

export interface ModuleOptions {
  iam: IamCredentials
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
    authenticatedPath: '/authenticated',
    afterLoginPath: '/dashboard',
    notAuthenticatedPath: '/not-authenticated',
    afterLogoutPath: '/',
    routePrefix: '/api/auth',
    composableAlias: 'useAuth',
  } as ModuleOptions,
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    const runtimeConfig = nuxt.options.runtimeConfig as Record<string, any>
    runtimeConfig.iam = defu(runtimeConfig.iam as Record<string, unknown> | undefined, options.iam)
    const routePrefix = options.routePrefix ?? '/api/auth'

    runtimeConfig.public.iamClient = defu(runtimeConfig.public.iamClient as Record<string, unknown> | undefined, {
      authenticatedPath: options.authenticatedPath,
      afterLoginPath: options.afterLoginPath,
      notAuthenticatedPath: options.notAuthenticatedPath,
      afterLogoutPath: options.afterLogoutPath,
      routePrefix,
    })

    addServerImportsDir(resolver.resolve('./runtime/server/utils'))

    addServerHandler({ middleware: true, handler: resolver.resolve('./runtime/server/middleware/auth') })
    addServerHandler({ route: `${routePrefix}/login`, method: 'get', handler: resolver.resolve('./runtime/server/api/auth/login.get') })
    addServerHandler({ route: `${routePrefix}/logout`, method: 'post', handler: resolver.resolve('./runtime/server/api/auth/logout.post') })
    addServerHandler({ route: `${routePrefix}/session`, method: 'get', handler: resolver.resolve('./runtime/server/api/auth/session.get') })

    addImports({
      name: 'useAuth',
      as: options.composableAlias ?? 'useAuth',
      from: resolver.resolve('./runtime/composables/useAuth'),
    })
  },
})
