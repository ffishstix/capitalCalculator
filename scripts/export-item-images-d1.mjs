import Database from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const output = resolve(process.argv[2] ?? '.tmp/item-images-d1.sql')
const db = new Database(join(process.cwd(), 'database', 'capitalrift.sqlite'), { readonly: true })
try {
  const rows = db.prepare('SELECT item_id, content_type, image_data, sha256, source_url, fetched_at FROM item_images ORDER BY item_id').all()
  if (!rows.length) throw new Error('No local item images to export. Run npm run items:images:refresh first.')
  const escape = value => `'${value.replaceAll("'", "''")}'`
  const statements = [
    `CREATE TABLE IF NOT EXISTS item_images (item_id TEXT PRIMARY KEY, content_type TEXT NOT NULL CHECK(content_type IN ('image/png', 'image/webp')), image_data BLOB NOT NULL, sha256 TEXT NOT NULL, source_url TEXT NOT NULL, fetched_at TEXT NOT NULL);`
  ]
  for (const row of rows) {
    const sql = `INSERT INTO item_images (item_id, content_type, image_data, sha256, source_url, fetched_at) VALUES (${escape(row.item_id)}, ${escape(row.content_type)}, x'${row.image_data.toString('hex')}', ${escape(row.sha256)}, ${escape(row.source_url)}, ${escape(row.fetched_at)}) ON CONFLICT(item_id) DO UPDATE SET content_type=excluded.content_type, image_data=excluded.image_data, sha256=excluded.sha256, source_url=excluded.source_url, fetched_at=excluded.fetched_at WHERE item_images.sha256 <> excluded.sha256 OR item_images.source_url <> excluded.source_url;`
    if (Buffer.byteLength(sql) > 100_000) throw new Error(`${row.item_id} exceeds D1's 100 KB SQL statement limit.`)
    statements.push(sql)
  }
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, statements.join('\n') + '\n')
  console.log(`Exported ${rows.length} item images to ${output} (${statements.join('\n').length} bytes).`)
} finally { db.close() }
