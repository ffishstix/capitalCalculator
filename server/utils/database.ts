import Database from 'better-sqlite3'
import { join } from 'node:path'

let database: Database.Database | undefined
export function getDatabase() {
  if (!database) {
    database = new Database(join(process.cwd(), 'database', 'capitalrift.sqlite'), { readonly: true })
    database.pragma('foreign_keys = ON')
  }
  return database
}
