import { getDatabase, type DatabaseClient, type Statement } from '../../utils/database'

const GAME_ORIGIN = 'https://play.capitalrift.com'
const GAME_TICKER_URL = `${GAME_ORIGIN}/api/market/ticker`
const REFRESH_INTERVAL_MS = 60 * 60 * 1000

type TickerItem = { id?: string; label?: string; kind?: string; price?: number; dayPct?: number }
type TickerPayload = { at?: number; items?: TickerItem[] }
type BookLevel = { price?: number; qty?: number }
type OrderBook = { commodity?: string; bids?: BookLevel[]; asks?: BookLevel[] }
type SyncPayload = TickerPayload | { ticker?: TickerPayload; orderBooks?: OrderBook[] }

function insertRows(db: DatabaseClient, table: string, columns: string[], rows: unknown[][], suffix = ''): Statement[] {
  if (!rows.length) return []
  const selects = columns.map((_, index) => `json_extract(value, '$[${index}]')`).join(',')
  return [db.prepare(`INSERT ${suffix === 'IGNORE' ? 'OR IGNORE ' : ''}INTO ${table} (${columns.join(',')})
    SELECT ${selects} FROM json_each(?) WHERE true ${suffix === 'IGNORE' ? '' : suffix}`).bind(JSON.stringify(rows))]
}

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin')
  const remoteAddress = event.node.req.socket?.remoteAddress
  const loopback = !event.context.cloudflare && (!remoteAddress || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '127.0.0.1')
  const env = (event.context.cloudflare as { env?: { PRICE_SYNC_TOKEN?: string } } | undefined)?.env
  const token = getRequestHeader(event, 'x-price-sync-token')
  const authorized = Boolean(env?.PRICE_SYNC_TOKEN && token && token === env.PRICE_SYNC_TOKEN)
  if (!authorized && (!loopback || (origin && origin !== GAME_ORIGIN))) {
    throw createError({ statusCode: 403, statusMessage: 'Price sync requires the configured sync token.' })
  }
  if (loopback && origin === GAME_ORIGIN) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': GAME_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Private-Network': 'true',
      'Vary': 'Origin'
    })
  }

  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody || rawBody.length > 2_000_000) throw createError({ statusCode: 413, statusMessage: 'The market payload is empty or too large.' })
  let payload: SyncPayload
  try { payload = JSON.parse(rawBody) as SyncPayload } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid market JSON.' }) }
  if (!payload || typeof payload !== 'object') throw createError({ statusCode: 400, statusMessage: 'Invalid market payload.' })
  const ticker = 'ticker' in payload && payload.ticker ? payload.ticker : payload as TickerPayload
  const orderBooks = 'orderBooks' in payload && Array.isArray(payload.orderBooks) ? payload.orderBooks : []
  const quoteAsOf = typeof ticker.at === 'number' && Number.isFinite(ticker.at) ? new Date(ticker.at).toISOString() : ''
  const items = (ticker.items ?? []).filter((item): item is TickerItem & { id: string; label: string; price: number } =>
    item.kind === 'item' && typeof item.id === 'string' && /^[A-Z0-9_]{1,80}$/.test(item.id)
    && typeof item.label === 'string' && item.label.length > 0
    && typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0)
  if (!quoteAsOf || !items.length) throw createError({ statusCode: 400, statusMessage: 'No usable timestamped item prices.' })
  const db = getDatabase(event)
  const latest = await db.prepare('SELECT attempted_at FROM market_item_sync_log ORDER BY id DESC LIMIT 1').first<{ attempted_at: string }>()
  if (getQuery(event).bypass !== '1' && latest && Date.now() - Date.parse(latest.attempted_at) < REFRESH_INTERVAL_MS) {
    throw createError({ statusCode: 429, statusMessage: 'Market prices can be synced once every hour.' })
  }
  const now = new Date()
  const attemptedAt = now.toISOString()
  const historyHour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString()
  const validIds = new Set(items.map(item => item.id))
  const books = orderBooks.filter(book => typeof book.commodity === 'string' && validIds.has(book.commodity)
    && (Array.isArray(book.bids) || Array.isArray(book.asks)))
  const { results: names } = await db.prepare('SELECT id, name FROM items').all<{ id: string; name: string }>()
  const nameById = new Map(names.map(row => [row.id, row.name]))
  const quoteRows = items.map(item => [item.id.toLowerCase(), nameById.get(item.id.toLowerCase()) ?? item.label,
    item.price, typeof item.dayPct === 'number' && Number.isFinite(item.dayPct) ? item.dayPct : null,
    quoteAsOf, attemptedAt, GAME_ORIGIN])
  const quoteHistory = items.map(item => [item.id.toLowerCase(), item.price, historyHour, attemptedAt])
  const best = (levels: BookLevel[] | undefined, side: 'bid' | 'ask') => {
    const valid = (levels ?? []).filter(level => typeof level.price === 'number' && Number.isFinite(level.price) && level.price >= 0)
    return valid.reduce<BookLevel | undefined>((winner, level) => !winner || (side === 'bid' ? level.price! > winner.price! : level.price! < winner.price!) ? level : winner, undefined)
  }
  const bookRows = books.map(book => {
    const bid = best(book.bids, 'bid')
    const ask = best(book.asks, 'ask')
    return [book.commodity!.toLowerCase(), bid?.price ?? null, bid?.qty ?? null, ask?.price ?? null,
      ask?.qty ?? null, ask?.price === undefined ? null : Math.max(0, ask.price - 0.01),
      attemptedAt, `${GAME_ORIGIN}/api/market/book?commodity=${encodeURIComponent(book.commodity!)}`]
  })
  const bookHistory = bookRows.map(row => [row[0], row[1], row[3], row[5], historyHour, attemptedAt])
  const statements = [
    ...insertRows(db, 'market_item_quotes', ['symbol','name','price','day_change_percent','quote_as_of','fetched_at','source_url'], quoteRows,
      'ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,price=excluded.price,day_change_percent=excluded.day_change_percent,quote_as_of=excluded.quote_as_of,fetched_at=excluded.fetched_at,source_url=excluded.source_url'),
    ...insertRows(db, 'market_item_quote_history', ['symbol','price','quote_as_of','fetched_at'], quoteHistory, 'IGNORE'),
    ...insertRows(db, 'market_item_order_books', ['symbol','best_bid','best_bid_quantity','best_ask','best_ask_quantity','suggested_sell_offer','fetched_at','source_url'], bookRows,
      'ON CONFLICT(symbol) DO UPDATE SET best_bid=excluded.best_bid,best_bid_quantity=excluded.best_bid_quantity,best_ask=excluded.best_ask,best_ask_quantity=excluded.best_ask_quantity,suggested_sell_offer=excluded.suggested_sell_offer,fetched_at=excluded.fetched_at,source_url=excluded.source_url'),
    ...insertRows(db, 'market_item_order_book_history', ['symbol','best_bid','best_ask','suggested_sell_offer','quote_as_of','fetched_at'], bookHistory, 'IGNORE'),
    db.prepare("DELETE FROM market_item_quote_history WHERE quote_as_of < datetime('now', '-90 days')"),
    db.prepare("DELETE FROM market_item_order_book_history WHERE quote_as_of < datetime('now', '-90 days')"),
    db.prepare(`INSERT INTO market_item_sync_log (attempted_at,completed_at,endpoint,quote_count,outcome,error_message)
      VALUES (?,?,?,?,?,?)`).bind(attemptedAt, new Date().toISOString(), GAME_TICKER_URL,
      books.length || items.length, books.length < items.length ? 'partial' : 'success',
      books.length < items.length ? `Received ${books.length} of ${items.length} order books.` : null)
  ]
  await db.batch(statements)
  return { ok: true, quoteCount: items.length, orderBookCount: books.length, quoteAsOf }
})
