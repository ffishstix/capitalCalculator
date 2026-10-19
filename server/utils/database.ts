import Database from 'better-sqlite3'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

let database: Database.Database | undefined
export function getDatabase() {
  if (!database) {
    database = new Database(join(process.cwd(), 'database', 'capitalrift.sqlite'))
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    database.exec(readFileSync(join(process.cwd(), 'database', 'schema.sql'), 'utf8'))
  }
  return database
}
