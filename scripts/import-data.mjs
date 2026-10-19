import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data', 'source')
const catalogPath = path.join(dataDir, 'factory-catalog.json')
const changelogPath = path.join(dataDir, 'changelog.json')
const dbPath = path.join(root, 'database', 'capitalrift.sqlite')
const retrievedAt = new Date().toISOString()
const sourceUrl = 'https://github.com/mrawsky/capitalrift-tools/tree/main/app/data'
const repositoryUrl = 'https://github.com/mrawsky/capitalrift-tools'
const revisionPath = path.join(dataDir, 'source-revision.txt')
const sourceRevision = process.env.SOURCE_REVISION ?? (fs.existsSync(revisionPath)
  ? fs.readFileSync(revisionPath, 'utf8').trim()
  : null)
for (const file of [catalogPath, changelogPath]) if (!fs.existsSync(file)) throw new Error(`Missing source file: ${file}`)

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'))
if (!catalog.items || !catalog.recipes || !Array.isArray(changelog.entries)) throw new Error('Unexpected source data format.')
const items = Object.entries(catalog.items)
const recipes = Object.entries(catalog.recipes)
const digest = crypto.createHash('sha256').update(fs.readFileSync(catalogPath)).update(fs.readFileSync(changelogPath)).digest('hex')

fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'))
const importAll = db.transaction(() => {
  db.exec(`DELETE FROM changelog_change_items; DELETE FROM changelog_changes; DELETE FROM changelog_entries;
    DELETE FROM recipe_ingredients; DELETE FROM recipes; DELETE FROM items;`)
  const result = db.prepare(`INSERT INTO source_imports
    (source_url, repository_url, source_revision, retrieved_at, dataset_sha256, item_count, recipe_count, changelog_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sourceUrl, repositoryUrl, sourceRevision,
      retrievedAt, digest, items.length, recipes.length, changelog.entries.length)
  const importId = Number(result.lastInsertRowid)
  const addItem = db.prepare('INSERT INTO items (id, name) VALUES (?, ?)')
  for (const [id, name] of items) addItem.run(id, name)
  const addRecipe = db.prepare(`INSERT INTO recipes
    (id, label, station_id, product_item_id, batch_output, rate_per_minute, source_import_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const addIngredient = db.prepare('INSERT INTO recipe_ingredients (recipe_id, item_id, quantity) VALUES (?, ?, ?)')
  for (const [id, recipe] of recipes) {
    addRecipe.run(id, recipe.label, recipe.station, recipe.product, recipe.batch, recipe.rate, importId)
    for (const [itemId, quantity] of Object.entries(recipe.inputs)) addIngredient.run(id, itemId, quantity)
  }
  const addEntry = db.prepare(`INSERT INTO changelog_entries
    (id, published_date, game_version, title, summary, evidence, source_import_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const addChange = db.prepare('INSERT INTO changelog_changes (entry_id, title, sort_order) VALUES (?, ?, ?)')
  const addChangeItem = db.prepare('INSERT INTO changelog_change_items (change_id, description, sort_order) VALUES (?, ?, ?)')
  for (const entry of changelog.entries) {
    addEntry.run(entry.id, entry.date, entry.gameVersion ?? null, entry.title, entry.summary, entry.evidence, importId)
    for (const [changeIndex, change] of (entry.changes ?? []).entries()) {
      const changeResult = addChange.run(entry.id, change.title, changeIndex)
      for (const [itemIndex, description] of (change.items ?? []).entries()) addChangeItem.run(Number(changeResult.lastInsertRowid), description, itemIndex)
    }
  }
})
try {
  importAll()
  const archiveName = `${(sourceRevision ?? 'unversioned').replace(/[^a-zA-Z0-9._-]/g, '_')}-${digest.slice(0, 12)}`
  const archiveDir = path.join(root, 'data', 'archive', archiveName)
  fs.mkdirSync(archiveDir, { recursive: true })
  for (const file of [catalogPath, changelogPath, revisionPath]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(archiveDir, path.basename(file)))
  }
  fs.writeFileSync(path.join(archiveDir, 'manifest.json'), JSON.stringify({
    sourceRevision, retrievedAt, sourceUrl, repositoryUrl, datasetSha256: digest,
    itemCount: items.length, recipeCount: recipes.length, changelogCount: changelog.entries.length
  }, null, 2) + '\n')
  console.log(JSON.stringify({
    items: db.prepare('SELECT COUNT(*) AS n FROM items').get().n,
    recipes: db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n,
    recipeIngredients: db.prepare('SELECT COUNT(*) AS n FROM recipe_ingredients').get().n,
    changelogEntries: db.prepare('SELECT COUNT(*) AS n FROM changelog_entries').get().n,
    archivedSnapshot: archiveDir,
    import: db.prepare('SELECT retrieved_at, dataset_sha256 FROM source_imports ORDER BY id DESC LIMIT 1').get()
  }, null, 2))
} finally { db.close() }
