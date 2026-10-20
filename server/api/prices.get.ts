import { getDatabase } from '../utils/database'

type Quote = { symbol: string; name: string; price: number; units24h: number; previousPrice: number | null }
type ItemQuote = { symbol: string; name: string; price: number; dayChangePercent: number | null; buyPrice: number | null; sellPrice: number | null; suggestedSellOffer: number | null; orderBookAsOf: string | null; previousPrice: number | null }
type PriceRow = { symbol: string; price: number }

export default defineEventHandler(async (event) => {
  const db = getDatabase(event)
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { results: quotes } = await db.prepare(`SELECT q.symbol, q.name, q.price, q.units24h,
      (SELECT h.price FROM market_quote_history h WHERE h.symbol = q.symbol AND h.quote_as_of < q.quote_as_of ORDER BY h.quote_as_of DESC LIMIT 1) AS previousPrice
    FROM market_quotes q ORDER BY q.name COLLATE NOCASE`).all<Quote>()
  const { results: historyRows } = await db.prepare(`SELECT symbol, price FROM market_quote_history
    WHERE quote_as_of >= ? ORDER BY quote_as_of`).bind(cutoff).all<PriceRow>()
  const { results: itemQuotes } = await db.prepare(`SELECT q.symbol, q.name, q.price, q.day_change_percent AS dayChangePercent,
      b.best_ask AS buyPrice, b.best_bid AS sellPrice, b.suggested_sell_offer AS suggestedSellOffer,
      b.fetched_at AS orderBookAsOf,
      (SELECT h.best_bid FROM market_item_order_book_history h WHERE h.symbol = q.symbol
        AND h.quote_as_of < (SELECT MAX(h2.quote_as_of) FROM market_item_order_book_history h2 WHERE h2.symbol = q.symbol)
        ORDER BY h.quote_as_of DESC LIMIT 1) AS previousPrice
    FROM market_item_quotes q LEFT JOIN market_item_order_books b ON b.symbol = q.symbol
    ORDER BY q.name COLLATE NOCASE`).all<ItemQuote>()
  const { results: itemHistoryRows } = await db.prepare(`SELECT symbol, best_bid AS price FROM market_item_order_book_history
    WHERE quote_as_of >= ? AND best_bid IS NOT NULL ORDER BY quote_as_of`).bind(cutoff).all<PriceRow>()
  const latestItemSync = await db.prepare('SELECT attempted_at, completed_at, outcome FROM market_item_sync_log ORDER BY id DESC LIMIT 1').first<{ attempted_at: string; completed_at: string | null; outcome: string }>()
  const latestLog = await db.prepare('SELECT attempted_at, outcome FROM market_refresh_log ORDER BY id DESC LIMIT 1').first<{ attempted_at: string; outcome: string }>()
  const snapshot = await db.prepare('SELECT MAX(quote_as_of) AS asOf FROM market_quotes').first<{ asOf: string | null }>()
  const itemSnapshot = await db.prepare('SELECT MAX(fetched_at) AS asOf FROM market_item_order_books').first<{ asOf: string | null }>()
  const orderBookCoverage = await db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN best_bid IS NOT NULL OR best_ask IS NOT NULL THEN 1 ELSE 0 END) AS available
    FROM market_item_order_books`).first<{ total: number; available: number | null }>()
  const itemQuoteCount = await db.prepare('SELECT COUNT(*) AS total FROM market_item_quotes').first<{ total: number }>()
  const catalogueCoverage = await db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN q.symbol IS NOT NULL THEN 1 ELSE 0 END) AS priced
    FROM items i LEFT JOIN market_item_quotes q ON q.symbol = i.id`).first<{ total: number; priced: number | null }>()
  const histories = (rows: PriceRow[]) => {
    const map = new Map<string, number[]>()
    for (const row of rows) map.set(row.symbol, [...(map.get(row.symbol) ?? []), row.price])
    return map
  }
  const publicHistory = histories(historyRows)
  const gameHistory = histories(itemHistoryRows)
  const mergedQuotes = new Map(quotes.map(quote => [quote.symbol.toLowerCase(), {
    ...quote,
    history: publicHistory.get(quote.symbol) ?? [quote.price],
    changeSincePreviousPercent: quote.previousPrice !== null && quote.previousPrice !== 0 ? (quote.price - quote.previousPrice) / quote.previousPrice * 100 : null,
    volumeKnown: true,
    dayChangePercent: null as number | null
  }]))
  for (const quote of itemQuotes) mergedQuotes.set(quote.symbol, {
    ...quote,
    units24h: 0,
    history: gameHistory.get(quote.symbol) ?? [quote.price],
    changeSincePreviousPercent: quote.previousPrice !== null && quote.previousPrice !== 0 ? (quote.price - quote.previousPrice) / quote.previousPrice * 100 : null,
    volumeKnown: false,
    dayChangePercent: quote.dayChangePercent
  })
  return {
    asOf: [snapshot?.asOf, itemSnapshot?.asOf].filter((value): value is string => Boolean(value)).sort().at(-1) ?? latestItemSync?.attempted_at ?? latestLog?.attempted_at ?? new Date().toISOString(),
    refreshedAt: latestItemSync?.completed_at ?? latestLog?.attempted_at ?? null,
    refreshOutcome: latestItemSync?.outcome ?? latestLog?.outcome ?? 'not_started',
    refreshIntervalHours: 1,
    catalogueCoverage: { priced: catalogueCoverage?.priced ?? 0, total: catalogueCoverage?.total ?? 0 },
    orderBookCoverage: { priced: orderBookCoverage?.available ?? 0, total: itemQuoteCount?.total ?? 0 },
    quotes: [...mergedQuotes.values()],
    source: 'Capital Rift market APIs'
  }
})
