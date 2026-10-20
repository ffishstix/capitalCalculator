import { getDatabase } from '../../../utils/database'
import { machineAssets } from '../../../utils/machine-assets'

export default defineEventHandler(async (event) => {
  const station = getRouterParam(event, 'station') ?? ''
  if (!/^[a-z0-9_]{1,80}$/.test(station)) throw createError({ statusCode: 400, statusMessage: 'Invalid machine ID' })
  if (machineAssets.has(station)) return sendRedirect(event, `/machines/${station}.png`, 302)
  const row = await getDatabase(event).prepare('SELECT image_data, content_type, sha256 FROM machine_images WHERE station_id = ?')
    .bind(station).first<{ image_data: number[] | Uint8Array; content_type: string; sha256: string }>()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Machine image not found' })
  setHeader(event, 'Content-Type', row.content_type)
  setHeader(event, 'Cache-Control', 'public, max-age=3600, must-revalidate')
  setHeader(event, 'ETag', `"${row.sha256}"`)
  if (getHeader(event, 'if-none-match') === `"${row.sha256}"`) {
    setResponseStatus(event, 304)
    return ''
  }
  return new Uint8Array(row.image_data)
})
