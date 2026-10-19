const GAME_ORIGIN = 'https://play.capitalrift.com'

export default defineEventHandler((event) => {
  if (getRequestHeader(event, 'origin') !== GAME_ORIGIN) {
    throw createError({ statusCode: 403, statusMessage: 'Price sync must come from the signed-in Capital Rift page.' })
  }
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': GAME_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  })
  setResponseStatus(event, 204)
  return null
})
