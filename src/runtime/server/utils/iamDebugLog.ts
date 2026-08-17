/**
 * Gated diagnostic logging for the iam SSO flow (login/callback/token
 * exchange/session refresh). Disabled by default; set
 * NUXT_ADD_DEBUG_LOGS=true in the consuming app to enable. Auto-imported
 * alongside the rest of ./utils by the module's addServerImportsDir.
 *
 * Named iamDebugLog (not debugLog) because it's auto-imported into whatever
 * app consumes this module, which may define its own debugLog — an
 * unprefixed name would silently collide, and unimport resolves collisions
 * by picking one source without erroring.
 */
export function isIamDebugLogEnabled(): boolean {
  return process.env.NUXT_ADD_DEBUG_LOGS === 'true'
}

export function iamDebugLog(scope: string, message: string, data?: Record<string, unknown>): void {
  if (!isIamDebugLogEnabled()) return
  if (data) {
    console.log(`[debug:iam-client:${scope}] ${message}`, data)
  } else {
    console.log(`[debug:iam-client:${scope}] ${message}`)
  }
}
