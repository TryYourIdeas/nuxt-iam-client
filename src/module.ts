import { addImportsDir, addServerHandler, addServerImportsDir, createResolver, defineNuxtModule } from '@nuxt/kit'
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
  } as ModuleOptions,
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    const runtimeConfig = nuxt.options.runtimeConfig as Record<string, any>
    runtimeConfig.iam = defu(runtimeConfig.iam as Record<string, unknown> | undefined, options.iam)
    runtimeConfig.public.iamClient = defu(runtimeConfig.public.iamClient as Record<string, unknown> | undefined, {
      authenticatedPath: options.authenticatedPath,
      afterLoginPath: options.afterLoginPath,
      notAuthenticatedPath: options.notAuthenticatedPath,
      afterLogoutPath: options.afterLogoutPath,
    })

    addServerImportsDir(resolver.resolve('./runtime/server/utils'))

    addServerHandler({ middleware: true, handler: resolver.resolve('./runtime/server/middleware/auth') })
    addServerHandler({ route: '/api/auth/login', method: 'get', handler: resolver.resolve('./runtime/server/api/auth/login.get') })
    addServerHandler({ route: '/api/auth/logout', method: 'post', handler: resolver.resolve('./runtime/server/api/auth/logout.post') })
    addServerHandler({ route: '/api/auth/session', method: 'get', handler: resolver.resolve('./runtime/server/api/auth/session.get') })

    addImportsDir(resolver.resolve('./runtime/composables'))
  },
})
