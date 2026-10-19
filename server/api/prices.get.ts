import { getDatabase } from '../utils/database'

const STATUS_URL = 'https://capitalrift.com/api/access/status'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

type MarketResponse = {
  serverNow?: string
  world?: { quotes?: Array<{ short?: string; name?: string; price?: number; units?: number }> }
}

export default defineEventHandler(async () => {
  const db = getDatabase()
  const latestAttempt = db.prepare('SELECT attempted_at FROM market_refresh_log ORDER BY id DESC LIMIT 1').get() as { attempted_at: string } | undefined
  const hasGameItemSnapshot = Boolean((db.prepare('SELECT 1 AS found FROM market_item_quotes LIMIT 1').get() as { found: number } | undefined)?.found)
  const isDue = !hasGameItemSnapshot && (!latestAttempt || Date.now() - Date.parse(latestAttempt.attempted_at) >= REFRESH_INTERVAL_MS)

  if (isDue) {
    const attempt = db.prepare(`INSERT INTO market_refresh_log (attempted_at, endpoint, outcome)
      VALUES (?, ?, 'pending')`).run(new Date().toISOString(), STATUS_URL)
    const logId = Number(attempt.lastInsertRowid)
    try {
      const response = await $fetch<MarketResponse>(STATUS_URL, { timeout: 10000 })
      const quotes = (response.world?.quotes ?? []).flatMap(quote => {
        if (!quote.short || !quote.name || !Number.isFinite(quote.price) || !Number.isFinite(quote.units)) return []
        return [{ symbol: quote.short, name: quote.name, price: quote.price!, units24h: quote.units! }]
      })
      if (!response.serverNow || !quotes.length) throw new Error('The public status feed contained no usable prices.')
      const saveSnapshot = db.transaction(() => {
        db.prepare('DELETE FROM market_quotes').run()
        const insert = db.prepare(`INSERT INTO market_quotes
          (symbol, name, price, units24h, quote_as_of, fetched_at, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        const insertHistory = db.prepare(`INSERT OR IGNORE INTO market_quote_history
          (symbol, name, price, units24h, quote_as_of, fetched_at, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        const fetchedAt = new Date().toISOString()
        for (const quote of quotes) {
          insert.run(quote.symbol, quote.name, quote.price, quote.units24h, response.serverNow, fetchedAt, 'https://capitalrift.com/')
          insertHistory.run(quote.symbol, quote.name, quote.price, quote.units24h, response.serverNow, fetchedAt, 'https://capitalrift.com/')
        }
        db.prepare("DELETE FROM market_quote_history WHERE quote_as_of < datetime('now', '-90 days')").run()
        db.prepare(`UPDATE market_refresh_log SET completed_at = ?, http_status = 200, quote_count = ?, outcome = 'success'
          WHERE id = ?`).run(fetchedAt, quotes.length, logId)
      })
      saveSnapshot()
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'Unknown upstream error.'
      db.prepare(`UPDATE market_refresh_log SET completed_at = ?, http_status = ?, outcome = 'failed', error_message = ? WHERE id = ?`)
        .run(new Date().toISOString(), getUpstreamStatus(error), message, logId)
    }
  }

  const quotes = db.prepare(`SELECT q.symbol, q.name, q.price, q.units24h,
      (SELECT h.price FROM market_quote_history h WHERE h.symbol = q.symbol AND h.quote_as_of < q.quote_as_of ORDER BY h.quote_as_of DESC LIMIT 1) AS previousPrice
    FROM market_quotes q ORDER BY q.name COLLATE NOCASE`).all() as Array<{ symbol: string; name: string; price: number; units24h: number; previousPrice: number | null }>
  const historyRows = db.prepare(`SELECT symbol, price FROM market_quote_history
    WHERE quote_as_of >= ? ORDER BY quote_as_of`).all(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) as Array<{ symbol: string; price: number }>
  const historyBySymbol = new Map<string, number[]>()
  for (const row of historyRows) historyBySymbol.set(row.symbol, [...(historyBySymbol.get(row.symbol) ?? []), row.price])
  const snapshot = db.prepare('SELECT MAX(quote_as_of) AS asOf FROM market_quotes').get() as { asOf: string | null }
  const latestLog = db.prepare('SELECT attempted_at, outcome FROM market_refresh_log ORDER BY id DESC LIMIT 1').get() as { attempted_at: string; outcome: string } | undefined
  const itemQuotes = db.prepare(`SELECT q.symbol, q.name, q.price, q.day_change_percent AS dayChangePercent,
      (SELECT h.price FROM market_item_quote_history h WHERE h.symbol = q.symbol AND h.quote_as_of < q.quote_as_of ORDER BY h.quote_as_of DESC LIMIT 1) AS previousPrice
    FROM market_item_quotes q ORDER BY q.name COLLATE NOCASE`).all() as Array<{ symbol: string; name: string; price: number; dayChangePercent: number | null; previousPrice: number | null }>
  const itemHistoryRows = db.prepare(`SELECT symbol, price FROM market_item_quote_history
    WHERE quote_as_of >= ? ORDER BY quote_as_of`).all(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) as Array<{ symbol: string; price: number }>
  const itemHistoryBySymbol = new Map<string, number[]>()
  for (const row of itemHistoryRows) itemHistoryBySymbol.set(row.symbol, [...(itemHistoryBySymbol.get(row.symbol) ?? []), row.price])
  const latestItemSync = db.prepare('SELECT attempted_at, completed_at, outcome FROM market_item_sync_log ORDER BY id DESC LIMIT 1').get() as { attempted_at: string; completed_at: string | null; outcome: string } | undefined
  const itemSnapshot = db.prepare('SELECT MAX(quote_as_of) AS asOf FROM market_item_quotes').get() as { asOf: string | null }
  const catalogueCoverage = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN q.symbol IS NOT NULL THEN 1 ELSE 0 END) AS priced
    FROM items i LEFT JOIN market_item_quotes q ON q.symbol = i.id`).get() as { total: number; priced: number }
  const mergedQuotes = new Map(quotes.map(quote => [quote.symbol.toLowerCase(), {
    ...quote,
    history: historyBySymbol.get(quote.symbol) ?? [quote.price],
    changeSincePreviousPercent: quote.previousPrice !== null && quote.previousPrice !== 0 ? (quote.price - quote.previousPrice) / quote.previousPrice * 100 : null,
    volumeKnown: true,
    dayChangePercent: null as number | null
  }]))
  for (const quote of itemQuotes) mergedQuotes.set(quote.symbol, {
    ...quote,
    units24h: 0,
    history: itemHistoryBySymbol.get(quote.symbol) ?? [quote.price],
    changeSincePreviousPercent: quote.previousPrice !== null && quote.previousPrice !== 0 ? (quote.price - quote.previousPrice) / quote.previousPrice * 100 : null,
    volumeKnown: false,
    dayChangePercent: quote.dayChangePercent
  })
  return {
    asOf: [snapshot.asOf, itemSnapshot.asOf].filter((value): value is string => Boolean(value)).sort().at(-1) ?? latestItemSync?.attempted_at ?? latestLog?.attempted_at ?? new Date().toISOString(),
    refreshedAt: latestItemSync?.completed_at ?? latestLog?.attempted_at ?? null,
    refreshOutcome: latestItemSync?.outcome ?? latestLog?.outcome ?? 'not_started',
    refreshIntervalHours: 24,
    catalogueCoverage: { priced: catalogueCoverage.priced, total: catalogueCoverage.total },
    quotes: [...mergedQuotes.values()],
    source: 'Capital Rift market APIs'
  }
})

function getUpstreamStatus(error: unknown): number | null {
  if (typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
  return null
}
