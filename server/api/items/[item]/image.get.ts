import { getDatabase } from '../../../utils/database'

export default defineEventHandler(async (event) => {
  const item = getRouterParam(event, 'item') ?? ''
  if (!/^[a-z0-9_]{1,80}$/.test(item)) throw createError({ statusCode: 400, statusMessage: 'Invalid item ID' })
  const row = await getDatabase(event).prepare('SELECT image_data, content_type, sha256 FROM item_images WHERE item_id = ?')
    .bind(item).first<{ image_data: number[] | Uint8Array; content_type: string; sha256: string }>()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Item image not found' })
  const etag = `"${row.sha256}"`
  setHeader(event, 'Content-Type', row.content_type)
  setHeader(event, 'Cache-Control', 'public, max-age=3600, must-revalidate')
  setHeader(event, 'ETag', etag)
  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return ''
  }
  return new Uint8Array(row.image_data)
})
