export default defineEventHandler(() => {
  throw createError({ statusCode: 410, statusMessage: 'This refresh endpoint was retired. Run npm run refresh:all to upload to /api/refresh.' })
})
