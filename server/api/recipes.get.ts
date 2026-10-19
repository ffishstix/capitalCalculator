import { getDatabase } from '../utils/database'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const search = String(query.search ?? '').trim()
  const station = String(query.station ?? '').trim()
  const clauses: string[] = []
  const params: string[] = []
  if (search) { clauses.push('(i.name LIKE ? OR r.label LIKE ? OR r.id LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
  if (station) { clauses.push('r.station_id = ?'); params.push(station) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const db = getDatabase()
  const rows = db.prepare(`SELECT r.id, r.label, r.station_id AS station, r.batch_output AS batch,
    r.rate_per_minute AS rate, i.id AS product_id, i.name AS product
    FROM recipes r JOIN items i ON i.id = r.product_item_id ${where} ORDER BY i.name COLLATE NOCASE`).all(...params) as Array<Record<string, unknown>>
  const ingredients = db.prepare(`SELECT ri.item_id, i.name, ri.quantity FROM recipe_ingredients ri
    JOIN items i ON i.id = ri.item_id WHERE ri.recipe_id = ? ORDER BY i.name COLLATE NOCASE`)
  return rows.map(recipe => ({ ...recipe, ingredients: ingredients.all(recipe.id) }))
})
