import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

let cachedDb: ReturnType<typeof drizzle> | undefined

/**
 * One connection pool per process, shared across every mount of this module
 * in the same app (e.g. home's admin + tenant instances) - reads
 * process.env.DATABASE_URL directly at call time rather than a module
 * option threaded through Nuxt runtimeConfig, matching every other
 * DB-touching file in this workspace and avoiding the build-time-baking
 * pitfall documented in module.ts's own comment about the iamClientInstances
 * runtimeConfig nesting.
 */
export function getSessionsDb() {
  if (!cachedDb) {
    const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres'
    const pool = new Pool({ connectionString })
    cachedDb = drizzle(pool)
  }
  return cachedDb
}
