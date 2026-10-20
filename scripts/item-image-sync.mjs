import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = 'https://play.capitalrift.com'
const port = Number(process.env.CAPITALRIFT_CHROME_DEBUG_PORT || 9228)
const debugUrl = `http://127.0.0.1:${port}`
const profile = resolve(root, '.capitalrift-session-profile')
const catalogIds = Object.keys(JSON.parse(readFileSync(resolve(root, 'data/source/factory-catalog.json'), 'utf8')).items).sort()

function chromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [process.env.CHROME_PATH, process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')]
    : process.platform === 'darwin'
      ? [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  const found = candidates.find(candidate => candidate && existsSync(candidate))
  if (!found) throw new Error('Google Chrome was not found. Set CHROME_PATH to its executable.')
  return found
}

async function connect() {
  let launched = false
  try {
    if (!(await fetch(`${debugUrl}/json/version`)).ok) throw new Error('Chrome debugging port is unavailable')
  } catch {
    const child = spawn(chromeExecutable(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--start-minimized', origin], { detached: true, stdio: 'ignore' })
    child.unref()
    launched = true
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try { if ((await fetch(`${debugUrl}/json/version`)).ok) break } catch {}
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
    }
  }
  return { browser: await chromium.connectOverCDP(debugUrl), launched }
}

function discover(bundle, bundleUrl) {
  // Vite includes both URL-backed assets and small images inlined as data URIs.
  const values = new Map([...bundle.matchAll(/(?:const\s*|,)([A-Za-z_$][\w$]*)="(data:image\/(?:webp|png);base64,[A-Za-z0-9+/=]+|\/assets\/[A-Za-z0-9_-]+\.(?:webp|png))"/g)]
    .map(match => [match[1], match[2]]))
  const mappings = new Map()
  for (const match of bundle.matchAll(/"\.\.\/assets\/(icons|furniture)\/([A-Za-z0-9_]+)\.(webp|png)":([A-Za-z_$][\w$]*)/g)) {
    const [, group, name, extension, variable] = match
    const id = name.toLowerCase()
    const value = values.get(variable)
    if (!value) throw new Error(`Could not resolve ${group}/${name}.${extension} in the current bundle.`)
    // Prefer the game's purpose-made inventory icon when both sources exist.
    if (group === 'icons' || !mappings.has(id)) mappings.set(id, { value, contentType: `image/${extension}`, sourceUrl: `${bundleUrl}#../assets/${group}/${name}.${extension}` })
  }
  const missing = catalogIds.filter(id => !mappings.has(id))
  if (missing.length) throw new Error(`Current game build has no image for: ${missing.join(', ')}`)
  return mappings
}

function validateImage(id, image, contentType) {
  if (image.length < 24 || image.length > 2_000_000) throw new Error(`${id}: invalid image size ${image.length}`)
  if (contentType === 'image/png') {
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || image.readUInt32BE(16) === 0 || image.readUInt32BE(20) === 0
      || image.readUInt32BE(16) > 2048 || image.readUInt32BE(20) > 2048) throw new Error(`${id}: invalid PNG`)
  } else if (contentType === 'image/webp') {
    if (image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP'
      || image.readUInt32LE(4) + 8 !== image.length) throw new Error(`${id}: invalid WebP`)
  } else throw new Error(`${id}: unsupported image type ${contentType}`)
}

async function main() {
  let browser
  let launched = false
  try {
    ;({ browser, launched } = await connect())
    const context = browser.contexts()[0]
    const page = context.pages().find(candidate => candidate.url().startsWith(origin)) ?? context.pages()[0] ?? await context.newPage()
    if (!page.url().startsWith(origin)) await page.goto(origin, { waitUntil: 'domcontentloaded' })
    const authorized = await page.evaluate(async () => (await fetch('/api/market/ticker', { credentials: 'same-origin', cache: 'no-store' })).status)
    if (authorized !== 200) throw new Error(`Saved game session returned HTTP ${authorized}. Run npm run prices:login first.`)
    const findBundle = async () => (await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)))
      .find(url => /^https:\/\/play\.capitalrift\.com\/assets\/main-[A-Za-z0-9_-]+\.js$/.test(url))
    let bundleUrl = await findBundle()
    if (!bundleUrl) { await page.reload({ waitUntil: 'domcontentloaded' }); bundleUrl = await findBundle() }
    if (!bundleUrl) throw new Error('Could not find the current game asset bundle.')
    const bundleResponse = await fetch(bundleUrl)
    if (!bundleResponse.ok) throw new Error(`Game bundle returned HTTP ${bundleResponse.status}`)
    const sources = discover(await bundleResponse.text(), bundleUrl)
    const images = []
    const ids = [...sources.keys()].sort()
    for (const id of ids) {
      const source = sources.get(id)
      let image
      if (source.value.startsWith('data:')) image = Buffer.from(source.value.slice(source.value.indexOf(',') + 1), 'base64')
      else {
        const response = await fetch(new URL(source.value, origin))
        if (!response.ok) throw new Error(`${id}: image returned HTTP ${response.status}`)
        if (response.headers.get('content-type')?.split(';')[0] !== source.contentType) throw new Error(`${id}: unexpected content type`)
        image = Buffer.from(await response.arrayBuffer())
      }
      validateImage(id, image, source.contentType)
      // Furniture renders are 256px PNGs; 128px WebP keeps the visual detail
      // needed by the planner while fitting D1's 100 KB SQL statement limit.
      const contentType = source.contentType === 'image/png' ? 'image/webp' : source.contentType
      if (source.contentType === 'image/png') image = await sharp(image).resize(128, 128, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
      validateImage(id, image, contentType)
      if (image.length > 48_000) throw new Error(`${id}: optimized image is too large for D1 import (${image.length} bytes)`)
      images.push({ id, image, contentType, sourceUrl: source.sourceUrl, sha256: createHash('sha256').update(image).digest('hex') })
    }
    const db = new Database(resolve(root, 'database/capitalrift.sqlite'))
    try {
      db.exec(readFileSync(resolve(root, 'database/schema.sql'), 'utf8'))
      const save = db.prepare(`INSERT INTO item_images (item_id, content_type, image_data, sha256, source_url, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET content_type=excluded.content_type,
        image_data=excluded.image_data, sha256=excluded.sha256, source_url=excluded.source_url, fetched_at=excluded.fetched_at
        WHERE item_images.sha256 <> excluded.sha256 OR item_images.source_url <> excluded.source_url`)
      const fetchedAt = new Date().toISOString()
      db.transaction(() => { for (const row of images) save.run(row.id, row.contentType, row.image, row.sha256, row.sourceUrl, fetchedAt) })()
      console.log(`Saved ${images.length}/${ids.length} item images to SQLite (${images.reduce((sum, row) => sum + row.image.length, 0)} bytes; largest ${Math.max(...images.map(row => row.image.length))} bytes).`)
    } finally { db.close() }
  } finally {
    if (browser) {
      if (launched) {
        try { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close') }
        catch { await browser.close().catch(() => {}) }
      } else await browser.close()
    }
  }
}

main().catch(error => { console.error(`Item image refresh failed: ${error.message}`); process.exitCode = 1 })
