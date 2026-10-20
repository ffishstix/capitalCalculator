import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const db = new Database(join(process.cwd(), 'database', 'capitalrift.sqlite'), { readonly: true })
try {
  const rows = db.prepare('SELECT station_id, image_data FROM machine_images ORDER BY station_id').all()
  mkdirSync(join(process.cwd(), 'public', 'machines'), { recursive: true })
  for (const row of rows) writeFileSync(join(process.cwd(), 'public', 'machines', `${row.station_id}.png`), row.image_data)
  writeFileSync(join(process.cwd(), 'server', 'utils', 'machine-assets.ts'),
    `export const machineAssets = new Set(${JSON.stringify(rows.map(row => row.station_id))})\n`)
  console.log(`Exported ${rows.length} machine images for Pages.`)
} finally {
  db.close()
}
