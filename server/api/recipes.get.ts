import { getDatabase } from '../utils/database'
import { machineAssets } from '../utils/machine-assets'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const search = String(query.search ?? '').trim()
  const station = String(query.station ?? '').trim()
  const clauses: string[] = []
  const params: string[] = []
  if (search) { clauses.push('(i.name LIKE ? OR r.label LIKE ? OR r.id LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
  if (station) { clauses.push('r.station_id = ?'); params.push(station) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const db = getDatabase(event)
  const { results: rows } = await db.prepare(`SELECT r.id, r.label, r.station_id AS station, r.batch_output AS batch,
    r.rate_per_minute AS rate, i.id AS product_id, i.name AS product
    FROM recipes r JOIN items i ON i.id = r.product_item_id ${where} ORDER BY i.name COLLATE NOCASE`).bind(...params).all<Record<string, unknown>>()
  const { results: ingredients } = await db.prepare(`SELECT ri.recipe_id, ri.item_id, i.name, ri.quantity FROM recipe_ingredients ri
    JOIN items i ON i.id = ri.item_id ORDER BY i.name COLLATE NOCASE`).all<{ recipe_id: string; item_id: string; name: string; quantity: number }>()
  const { results: imageRows } = await db.prepare('SELECT item_id FROM item_images').all<{ item_id: string }>()
  const itemImages = new Set(imageRows.map(row => row.item_id))
  const byRecipe = new Map<string, typeof ingredients>()
  for (const ingredient of ingredients) byRecipe.set(ingredient.recipe_id, [...(byRecipe.get(ingredient.recipe_id) ?? []), ingredient])
  return rows.map(recipe => ({
    ...recipe,
    image_url: machineAssets.has(String(recipe.station)) ? `/machines/${recipe.station}.png` : null,
    product_image_url: itemImages.has(String(recipe.product_id)) ? `/api/items/${recipe.product_id}/image` : null,
    ingredients: (byRecipe.get(String(recipe.id)) ?? []).map(({ recipe_id, ...rest }) => ({ ...rest, image_url: itemImages.has(rest.item_id) ? `/api/items/${rest.item_id}/image` : null }))
  }))
})
