import { sql } from 'drizzle-orm'
import { bigint, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const iamClientSessions = pgTable(
  'iam_client_sessions',
  {
    id: text('id').primaryKey(),
    instanceId: text('instance_id').notNull(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    // Epoch-millis number, not timestamptz - matches Session.accessTokenExpiresAt's
    // existing `number` type exactly, so the `Date.now() >= session.accessTokenExpiresAt`
    // comparison in getIamSession needs no changes.
    accessTokenExpiresAt: bigint('access_token_expires_at', { mode: 'number' }).notNull(),
    appId: text('app_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('iam_client_sessions_instance_id_idx').on(table.instanceId)],
)

export type IamClientSessionRow = typeof iamClientSessions.$inferSelect
export type NewIamClientSessionRow = typeof iamClientSessions.$inferInsert
