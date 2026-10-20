import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { H3Event } from 'h3'

type QueryResult<T> = { results: T[] }
type RunResult = { meta: { last_row_id: number } }
export type Statement = {
  bind: (...values: unknown[]) => Statement
  all: <T = Record<string, unknown>>() => Promise<QueryResult<T>>
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<RunResult>
}
export type DatabaseClient = {
  prepare: (sql: string) => Statement
  batch: (statements: Statement[]) => Promise<unknown>
}

let localDatabase: import('better-sqlite3').Database | undefined
async function local() {
  if (!localDatabase) {
    const { default: Database } = await import('better-sqlite3')
    localDatabase = new Database(join(process.cwd(), 'database', 'capitalrift.sqlite'))
    localDatabase.pragma('foreign_keys = ON')
    localDatabase.pragma('journal_mode = WAL')
    localDatabase.exec(readFileSync(join(process.cwd(), 'database', 'schema.sql'), 'utf8'))
  }
  return localDatabase
}

function localStatement(sql: string, values: unknown[] = []): Statement {
  return {
    bind: (...args) => localStatement(sql, args),
    all: async <T>() => ({ results: (await local()).prepare(sql).all(...values) as T[] }),
    first: async <T>() => ((await local()).prepare(sql).get(...values) as T | undefined) ?? null,
    run: async () => {
      const result = (await local()).prepare(sql).run(...values)
      return { meta: { last_row_id: Number(result.lastInsertRowid) } }
    }
  }
}

const localClient: DatabaseClient = {
  prepare: sql => localStatement(sql),
  batch: async statements => {
    // Local callers use sequential statements; D1's batch is atomic.
    for (const statement of statements) await statement.run()
  }
}

export function getDatabase(event: H3Event): DatabaseClient {
  const cloudflare = event.context.cloudflare as { env?: { DB?: DatabaseClient } } | undefined
  return cloudflare?.env?.DB ?? localClient
}
