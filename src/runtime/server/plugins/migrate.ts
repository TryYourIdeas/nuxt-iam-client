import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { defineNitroPlugin } from 'nitropack/runtime/plugin'
import { getHeader, createError } from 'h3'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getSessionsDb } from '../db/client'

interface MigrationStorage {
  getKeys(): Promise<string[]> | string[]
  getItem(key: string): Promise<unknown> | unknown
}

async function materializeMigrationAssets(storage: MigrationStorage): Promise<string> {
  const keys = await storage.getKeys()
  const dir = mkdtempSync(join(tmpdir(), 'nuxt-iam-client-migrations-'))

  for (const key of keys) {
    const relativePath = key.replace(/:/g, '/')
    const content = await storage.getItem(key)
    const filePath = join(dir, relativePath)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content))
  }

  return dir
}

export default defineNitroPlugin((nitroApp) => {
  let migrationPromise: Promise<void> | null = null

  nitroApp.hooks.hook('request', async (event) => {
    if (getHeader(event, 'x-nitro-prerender')) return

    if (!migrationPromise) {
      migrationPromise = (async () => {
        const dir = await materializeMigrationAssets(useStorage('assets:nuxtIamClientMigrations'))
        await migrate(getSessionsDb(), { migrationsFolder: dir })
      })()
        .then(() => console.log('nuxt-iam-client: session store migrations applied'))
        .catch((error) => {
          console.error('nuxt-iam-client: session store migration failed:', error)
          migrationPromise = null
          throw error
        })
    }

    try {
      await migrationPromise
    } catch {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service temporarily unavailable: iam session store migration failed',
      })
    }
  })
})
