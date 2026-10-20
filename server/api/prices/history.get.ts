import { getDatabase } from '../../utils/database'

const RANGE_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000
} as const

type Range = keyof typeof RANGE_MS
type PricePoint = { at: string; reference: number | null; bid: number | null; ask: number | null }
type ReferenceRow = { symbol: string; price: number; quote_as_of: string }
type BookRow = { symbol: string; best_bid: number | null; best_ask: number | null; quote_as_of: string }
type NameRow = { symbol: string; name: string }

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const rawSymbols = query.symbols
  const rawRange = query.range ?? '30d'
  if (typeof rawSymbols !== 'string' || !rawSymbols || typeof rawRange !== 'string'
    || !Object.hasOwn(RANGE_MS, rawRange)) {
    throw createError({ statusCode: 400, statusMessage: 'Supply symbols and a range of 24h, 7d, 30d, or 90d.' })
  }

  const requested = rawSymbols.split(',')
  if (!requested.length || requested.length > 100 || requested.some(symbol => !/^[a-z0-9_]{1,80}$/i.test(symbol))) {
    throw createError({ statusCode: 400, statusMessage: 'Supply 1 to 100 comma-separated item symbols.' })
  }
  const symbols = requested.map(symbol => symbol.toLowerCase())
  if (new Set(symbols).size !== symbols.length) {
    throw createError({ statusCode: 400, statusMessage: 'Each item symbol may appear only once.' })
  }

  const range = rawRange as Range
  const to = new Date()
  const from = new Date(to.getTime() - RANGE_MS[range])
  const fromIso = from.toISOString()
  const toIso = to.toISOString()
  const db = getDatabase(event)
  const placeholders = symbols.map(() => '?').join(', ')
  const names = new Map<string, string>()
  const saveNames = (rows: NameRow[]) => {
    for (const row of rows) {
      const symbol = row.symbol.toLowerCase()
      if (!names.has(symbol)) names.set(symbol, row.name)
    }
  }
  saveNames((await db.prepare(`SELECT id AS symbol, name FROM items WHERE id IN (${placeholders})`).bind(...symbols).all<NameRow>()).results)
  saveNames((await db.prepare(`SELECT symbol, name FROM market_item_quotes WHERE symbol IN (${placeholders})`).bind(...symbols).all<NameRow>()).results)
  saveNames((await db.prepare(`SELECT symbol, name FROM market_quotes WHERE symbol COLLATE NOCASE IN (${placeholders})`).bind(...symbols).all<NameRow>()).results)

  // The game ticker takes precedence over the public feed, as on /api/prices.
  const gameSymbols = new Set((await db.prepare(`SELECT symbol FROM market_item_quotes WHERE symbol IN (${placeholders})`)
    .bind(...symbols).all<{ symbol: string }>()).results.map(row => row.symbol.toLowerCase()))
  const publicSymbols = symbols.filter(symbol => !gameSymbols.has(symbol))
  const points = new Map(symbols.map(symbol => [symbol, new Map<string, PricePoint>()]))
  const pointFor = (symbol: string, timestamp: string): PricePoint | undefined => {
    const time = Date.parse(timestamp)
    if (!Number.isFinite(time) || time < from.getTime() || time > to.getTime()) return
    const at = new Date(time).toISOString()
    const group = points.get(symbol.toLowerCase())
    if (!group) return
    let point = group.get(at)
    if (!point) {
      point = { at, reference: null, bid: null, ask: null }
      group.set(at, point)
    }
    return point
  }

  const itemReferences = (await db.prepare(`SELECT symbol, price, quote_as_of FROM market_item_quote_history
    WHERE symbol IN (${placeholders}) AND quote_as_of >= ? AND quote_as_of <= ?`)
    .bind(...symbols, fromIso, toIso).all<ReferenceRow>()).results
  for (const row of itemReferences) {
    const point = pointFor(row.symbol, row.quote_as_of)
    if (point && Number.isFinite(row.price)) point.reference = row.price
  }

  const books = (await db.prepare(`SELECT symbol, best_bid, best_ask, quote_as_of FROM market_item_order_book_history
    WHERE symbol IN (${placeholders}) AND quote_as_of >= ? AND quote_as_of <= ?`)
    .bind(...symbols, fromIso, toIso).all<BookRow>()).results
  for (const row of books) {
    const point = pointFor(row.symbol, row.quote_as_of)
    if (point) {
      point.bid = row.best_bid !== null && Number.isFinite(row.best_bid) ? row.best_bid : null
      point.ask = row.best_ask !== null && Number.isFinite(row.best_ask) ? row.best_ask : null
    }
  }

  if (publicSymbols.length) {
    const publicPlaceholders = publicSymbols.map(() => '?').join(', ')
    const publicReferences = (await db.prepare(`SELECT symbol, price, quote_as_of FROM market_quote_history
      WHERE symbol COLLATE NOCASE IN (${publicPlaceholders}) AND quote_as_of >= ? AND quote_as_of <= ?`)
      .bind(...publicSymbols, fromIso, toIso).all<ReferenceRow>()).results
    for (const row of publicReferences) {
      const point = pointFor(row.symbol, row.quote_as_of)
      if (point && Number.isFinite(row.price)) point.reference = row.price
    }
  }

  return {
    range,
    from: fromIso,
    to: toIso,
    series: symbols.map(symbol => ({
      symbol,
      name: names.get(symbol) ?? symbol,
      points: [...points.get(symbol)!.values()].sort((a, b) => a.at.localeCompare(b.at))
    }))
  }
})
