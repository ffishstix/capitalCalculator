import { getDatabase } from '../../utils/database'

const GAME_ORIGIN = 'https://play.capitalrift.com'
const GAME_TICKER_URL = `${GAME_ORIGIN}/api/market/ticker`
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

type TickerItem = { id?: string; label?: string; kind?: string; price?: number; dayPct?: number; flat?: boolean }
type TickerPayload = { at?: number; items?: TickerItem[] }

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin')
  const remoteAddress = event.node.req.socket.remoteAddress ?? ''
  const loopbackRequest = remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '127.0.0.1'
  if (origin !== GAME_ORIGIN && (origin || !loopbackRequest)) {
    throw createError({ statusCode: 403, statusMessage: 'Price sync must come from the signed-in Capital Rift page.' })
  }
  if (origin === GAME_ORIGIN) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': GAME_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Private-Network': 'true',
      'Vary': 'Origin'
    })
  }

  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody || rawBody.length > 2_000_000) {
    throw createError({ statusCode: 413, statusMessage: 'The market ticker payload is empty or too large.' })
  }

  let ticker: TickerPayload
  try {
    ticker = JSON.parse(rawBody) as TickerPayload
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'The market ticker payload is not valid JSON.' })
  }

  const quoteAsOf = typeof ticker.at === 'number' && Number.isFinite(ticker.at)
    ? new Date(ticker.at).toISOString()
    : ''
  const items = (ticker.items ?? []).filter((item): item is TickerItem & { id: string; label: string; price: number } =>
    item.kind === 'item' && typeof item.id === 'string' && /^[A-Z0-9_]{1,80}$/.test(item.id)
    && typeof item.label === 'string' && item.label.length > 0
    && typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0)
  if (!quoteAsOf || !items.length) {
    throw createError({ statusCode: 400, statusMessage: 'The ticker did not contain a timestamp and usable item prices.' })
  }

  const db = getDatabase()
  const latestSync = db.prepare('SELECT attempted_at FROM market_item_sync_log ORDER BY id DESC LIMIT 1').get() as { attempted_at: string } | undefined
  if (latestSync && Date.now() - Date.parse(latestSync.attempted_at) < REFRESH_INTERVAL_MS) {
    throw createError({ statusCode: 429, statusMessage: 'Market item prices can be synced once every 24 hours.' })
  }

  const attemptedAt = new Date().toISOString()
  const logResult = db.prepare(`INSERT INTO market_item_sync_log (attempted_at, endpoint, outcome)
    VALUES (?, ?, 'pending')`).run(attemptedAt, GAME_TICKER_URL)
  const logId = Number(logResult.lastInsertRowid)
  const resolveName = db.prepare('SELECT name FROM items WHERE id = ?')
  const saveSnapshot = db.transaction(() => {
    const upsert = db.prepare(`INSERT INTO market_item_quotes
      (symbol, name, price, day_change_percent, quote_as_of, fetched_at, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, price=excluded.price,
        day_change_percent=excluded.day_change_percent, quote_as_of=excluded.quote_as_of,
        fetched_at=excluded.fetched_at, source_url=excluded.source_url`)
    const addHistory = db.prepare(`INSERT OR IGNORE INTO market_item_quote_history
      (symbol, price, quote_as_of, fetched_at) VALUES (?, ?, ?, ?)`)
    for (const item of items) {
      const symbol = item.id.toLowerCase()
      const catalogItem = resolveName.get(symbol) as { name: string } | undefined
      const name = catalogItem?.name ?? item.label
      const dayChange = typeof item.dayPct === 'number' && Number.isFinite(item.dayPct) ? item.dayPct : null
      upsert.run(symbol, name, item.price, dayChange, quoteAsOf, attemptedAt, GAME_ORIGIN)
      addHistory.run(symbol, item.price, quoteAsOf, attemptedAt)
    }
    db.prepare("DELETE FROM market_item_quote_history WHERE quote_as_of < datetime('now', '-90 days')").run()
    db.prepare(`UPDATE market_item_sync_log SET completed_at = ?, quote_count = ?, outcome = 'success' WHERE id = ?`)
      .run(new Date().toISOString(), items.length, logId)
  })
  try {
    saveSnapshot()
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown database error.'
    db.prepare(`UPDATE market_item_sync_log SET completed_at = ?, outcome = 'failed', error_message = ? WHERE id = ?`)
      .run(new Date().toISOString(), message, logId)
    throw createError({ statusCode: 500, statusMessage: 'The market item snapshot could not be saved.' })
  }
  return { ok: true, quoteCount: items.length, quoteAsOf }
})
