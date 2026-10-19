type MarketResponse = {
  serverNow?: string
  world?: {
    quotes?: Array<{ short?: string; name?: string; price?: number; units?: number }>
  }
}

export default defineCachedEventHandler(async () => {
  let response: MarketResponse
  try {
    response = await $fetch<MarketResponse>('https://capitalrift.com/api/access/status', { timeout: 5000 })
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Live market prices are temporarily unavailable.' })
  }

  const quotes = (response.world?.quotes ?? []).flatMap(quote => {
    if (!quote.short || !quote.name || !Number.isFinite(quote.price) || !Number.isFinite(quote.units)) return []
    return [{ symbol: quote.short, name: quote.name, price: quote.price!, units24h: quote.units! }]
  })
  if (!response.serverNow || !quotes.length) {
    throw createError({ statusCode: 503, statusMessage: 'The live market feed did not return any quotes.' })
  }
  return { asOf: response.serverNow, quotes, source: 'https://capitalrift.com/' }
}, { maxAge: 60 })
