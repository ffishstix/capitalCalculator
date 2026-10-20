import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import sharp from 'sharp'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE_DIR = resolve(PROJECT_ROOT, '.capitalrift-session-profile')
const GAME_ORIGIN = 'https://play.capitalrift.com'
const TICKER_PATH = '/api/market/ticker'
const PLANNER_SYNC_URL = new URL('/api/refresh', process.env.PLANNER_SYNC_URL || 'https://fishstix.uk').href
const REQUEST_DELAY_MS = Number.isFinite(Number(process.env.CAPITALRIFT_REQUEST_DELAY_MS))
  ? Math.max(0, Number(process.env.CAPITALRIFT_REQUEST_DELAY_MS))
  : 1_000
const LOGIN_WAIT_MS = 10 * 60 * 1_000
const LOGIN_POLL_MS = 10_000
const DEBUGGING_PORT = Number(process.env.CAPITALRIFT_CHROME_DEBUG_PORT || 9228)
const DEBUGGING_URL = `http://127.0.0.1:${DEBUGGING_PORT}`
const IMAGE_DB = resolve(PROJECT_ROOT, 'database/capitalrift.sqlite')
const LAST_SUCCESS_FILE = resolve(PROJECT_ROOT, '.tmp/refresh-last-success.json')
const catalogue = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'data/source/factory-catalog.json'), 'utf8'))
const catalogIds = Object.keys(catalogue.items).sort()
const stations = [...new Set(Object.values(catalogue.recipes).map(recipe => recipe.station))].sort()

const mode = process.argv[2]
if (!['login', 'refresh'].includes(mode)) {
  console.error('Usage: npm run prices:login | npm run refresh:all')
  process.exitCode = 2
} else if (mode === 'login') {
  await login()
} else {
  await refresh()
}

function chromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.CHROME_PATH,
        process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
        process.env['PROGRAMFILES'] && resolve(process.env['PROGRAMFILES'], 'Google/Chrome/Application/chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && resolve(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')
      ]
    : process.platform === 'darwin'
      ? [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']

  const executable = candidates.find((candidate) => candidate && existsSync(candidate))
  if (!executable) throw new Error('Google Chrome was not found. Install Chrome or set CHROME_PATH to its executable.')
  return executable
}

async function waitForDevTools(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${DEBUGGING_URL}/json/version`)
      if (response.ok) return await response.json()
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Chrome did not open its local debugging connection on port ${DEBUGGING_PORT}.`)
}

async function connectGameBrowser({ minimized = false } = {}) {
  await mkdir(PROFILE_DIR, { recursive: true })
  let alreadyRunning = false
  try {
    const response = await fetch(`${DEBUGGING_URL}/json/version`)
    alreadyRunning = response.ok
  } catch {}

  if (!alreadyRunning) {
    const args = [
      `--remote-debugging-port=${DEBUGGING_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(minimized ? ['--start-minimized'] : []),
      GAME_ORIGIN
    ]
    const child = spawn(chromeExecutable(), args, { detached: true, stdio: 'ignore' })
    child.unref()
    console.log('Opening standard Google Chrome with the dedicated Capital Rift profile.')
    console.log('No browser automation launch flags are used. Complete Google sign-in in the Chrome window.')
    await waitForDevTools()
  }

  const browser = await chromium.connectOverCDP(DEBUGGING_URL)
  const context = browser.contexts()[0]
  if (!context) {
    await browser.close()
    throw new Error('The Chrome debugging connection has no browser profile attached.')
  }
  return { browser, context }
}

async function minimizeChrome(context, page) {
  const session = await context.newCDPSession(page)
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget')
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
  } finally {
    await session.detach().catch(() => {})
  }
}

async function closeChrome(browser) {
  try {
    const session = await browser.newBrowserCDPSession()
    await session.send('Browser.close')
  } catch {
    // At minimum, release the debugging connection if Chrome has already exited.
    await browser.close().catch(() => {})
  }
}

async function openGamePage(context) {
  const page = context.pages().find((candidate) => candidate.url().startsWith(GAME_ORIGIN)) ?? context.pages()[0] ?? await context.newPage()
  if (!page.url().startsWith(GAME_ORIGIN)) await page.goto(GAME_ORIGIN, { waitUntil: 'domcontentloaded' })
  return page
}

async function tickerStatus(page) {
  if (new URL(page.url()).origin !== GAME_ORIGIN) return { status: 401 }
  return page.evaluate(async (path) => {
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) return { status: response.status }
      return { status: response.status, ticker: await response.json() }
    } catch (error) {
      return { status: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }, TICKER_PATH)
}

async function login() {
  console.log('This tool never asks for or stores your Google password.')
  let browser
  try {
    const connected = await connectGameBrowser()
    browser = connected.browser
    const page = await openGamePage(connected.context)
    const deadline = Date.now() + LOGIN_WAIT_MS
    while (Date.now() < deadline) {
      const status = await tickerStatus(page)
      if (status.status === 200 && Array.isArray(status.ticker?.items)) {
        console.log(`Sign-in confirmed. Ticker contains ${status.ticker.items.length} entries.`)
        console.log('Chrome stays open for refreshes. You can close it when finished; the session remains in the local profile.')
        return
      }
      if (status.status && status.status !== 401 && status.status !== 403) {
        throw new Error(`Ticker returned HTTP ${status.status}; check that Capital Rift is available.`)
      }
      console.log('Waiting for Google sign-in to complete…')
      await new Promise((resolvePromise) => setTimeout(resolvePromise, LOGIN_POLL_MS))
    }
    throw new Error('Sign-in was not detected after 10 minutes. Check the Chrome window and try again.')
  } catch (error) {
    console.error(`Price login failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    // Disconnect Playwright without closing the user's normal Chrome session.
    await browser?.close()
  }
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function validateImage(id, bytes, contentType, maxBytes) {
  if (bytes.length < 24 || bytes.length > maxBytes) throw new Error(`${id}: invalid image size ${bytes.length}`)
  if (contentType === 'image/png') {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0
      || bytes.readUInt32BE(16) > 2048 || bytes.readUInt32BE(20) > 2048) throw new Error(`${id}: invalid PNG`)
  } else if (contentType === 'image/webp') {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP'
      || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error(`${id}: invalid WebP`)
  } else throw new Error(`${id}: unsupported image type ${contentType}`)
}

async function currentBundle(page) {
  const find = async () => (await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)))
    .find(url => /^https:\/\/play\.capitalrift\.com\/assets\/main-[A-Za-z0-9_-]+\.js$/.test(url))
  let url = await find()
  if (!url) { await page.reload({ waitUntil: 'domcontentloaded' }); url = await find() }
  if (!url) throw new Error('Could not find the current game asset bundle.')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Game bundle returned HTTP ${response.status}`)
  return { url, text: await response.text() }
}

function itemSources(bundle, bundleUrl) {
  const values = new Map([...bundle.matchAll(/(?:const\s*|,)([A-Za-z_$][\w$]*)="(data:image\/(?:webp|png);base64,[A-Za-z0-9+/=]+|\/assets\/[A-Za-z0-9_-]+\.(?:webp|png))"/g)]
    .map(match => [match[1], match[2]]))
  const result = new Map()
  for (const match of bundle.matchAll(/"\.\.\/assets\/(icons|furniture)\/([A-Za-z0-9_]+)\.(webp|png)":([A-Za-z_$][\w$]*)/g)) {
    const [, group, name, extension, variable] = match
    const id = name.toLowerCase()
    const value = values.get(variable)
    if (!value) throw new Error(`Could not resolve ${group}/${name}.${extension} in the current bundle.`)
    if (group === 'icons' || !result.has(id)) result.set(id, {
      value, contentType: `image/${extension}`, sourceUrl: `${bundleUrl}#../assets/${group}/${name}.${extension}`
    })
  }
  const missing = catalogIds.filter(id => !result.has(id))
  if (missing.length) throw new Error(`Current game build has no image for: ${missing.join(', ')}`)
  return result
}

function machineSources(bundle) {
  const assets = [...new Set(bundle.match(/\/assets\/[a-z0-9_]+-[A-Za-z0-9_-]+\.png/g) ?? [])]
  const result = new Map()
  for (const station of stations) {
    const matching = assets.filter(path => new RegExp(`^/assets/${station}-[A-Za-z0-9_-]+\\.png$`).test(path))
    if (matching.length !== 1) throw new Error(`Expected one PNG for ${station}; found ${matching.length}.`)
    result.set(station, { value: matching[0], contentType: 'image/png', sourceUrl: new URL(matching[0], GAME_ORIGIN).href })
  }
  return result
}

async function collectImages(bundle, bundleUrl) {
  const itemMap = itemSources(bundle, bundleUrl)
  const machineMap = machineSources(bundle)
  const db = new Database(IMAGE_DB)
  try {
    db.exec(readFileSync(resolve(PROJECT_ROOT, 'database/schema.sql'), 'utf8'))
    const itemCache = new Map(db.prepare('SELECT item_id AS id, content_type AS contentType, image_data AS data, sha256, source_url AS sourceUrl FROM item_images').all().map(row => [row.id, row]))
    const machineCache = new Map(db.prepare('SELECT station_id AS id, content_type AS contentType, image_data AS data, sha256, source_url AS sourceUrl FROM machine_images').all().map(row => [row.id, row]))
    const itemSave = db.prepare(`INSERT INTO item_images (item_id,content_type,image_data,sha256,source_url,fetched_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,
      sha256=excluded.sha256,source_url=excluded.source_url,fetched_at=excluded.fetched_at`)
    const machineSave = db.prepare(`INSERT INTO machine_images (station_id,content_type,image_data,sha256,source_url,fetched_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(station_id) DO UPDATE SET content_type=excluded.content_type,image_data=excluded.image_data,
      sha256=excluded.sha256,source_url=excluded.source_url,fetched_at=excluded.fetched_at`)
    const fetchedAt = new Date().toISOString()
    let downloaded = 0
    const collect = async (id, source, cached, kind) => {
      if (cached?.sourceUrl === source.sourceUrl) {
        validateImage(id, cached.data, cached.contentType, kind === 'item' ? 48_000 : 2_000_000)
        if (sha256(cached.data) === cached.sha256) return cached
      }
      let bytes
      if (source.value.startsWith('data:')) bytes = Buffer.from(source.value.slice(source.value.indexOf(',') + 1), 'base64')
      else {
        const response = await fetch(new URL(source.value, GAME_ORIGIN))
        if (!response.ok) throw new Error(`${id}: image returned HTTP ${response.status}`)
        if (response.headers.get('content-type')?.split(';')[0] !== source.contentType) throw new Error(`${id}: unexpected image content type`)
        bytes = Buffer.from(await response.arrayBuffer())
        downloaded += 1
      }
      validateImage(id, bytes, source.contentType, 2_000_000)
      const contentType = kind === 'item' && source.contentType === 'image/png' ? 'image/webp' : source.contentType
      if (contentType !== source.contentType) bytes = await sharp(bytes).resize(128, 128, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
      validateImage(id, bytes, contentType, kind === 'item' ? 48_000 : 2_000_000)
      const row = { id, contentType, data: bytes, sha256: sha256(bytes), sourceUrl: source.sourceUrl }
      ;(kind === 'item' ? itemSave : machineSave).run(id, contentType, bytes, row.sha256, row.sourceUrl, fetchedAt)
      return row
    }
    const itemImages = []
    for (const [id, source] of [...itemMap].sort(([a], [b]) => a.localeCompare(b))) itemImages.push(await collect(id, source, itemCache.get(id), 'item'))
    const machineImages = []
    for (const [id, source] of [...machineMap].sort(([a], [b]) => a.localeCompare(b))) machineImages.push(await collect(id, source, machineCache.get(id), 'machine'))
    console.log(`Images: ${itemImages.length} items and ${machineImages.length} machines ready; ${downloaded} asset files downloaded.`)
    const encode = image => ({ id: image.id, contentType: image.contentType, data: image.data.toString('base64'), sha256: image.sha256, sourceUrl: image.sourceUrl })
    return { itemImages: itemImages.map(encode), machineImages: machineImages.map(encode) }
  } finally { db.close() }
}

async function refresh() {
  let browser
  try {
    const previous = await readFile(LAST_SUCCESS_FILE, 'utf8').then(JSON.parse).catch(() => null)
    if (previous?.at && Date.now() - Date.parse(previous.at) < 60 * 60 * 1000) {
      console.log(`Last successful upload was ${previous.at}; wait one hour before refreshing again.`)
      return
    }
    const connected = await connectGameBrowser({ minimized: true })
    browser = connected.browser
    const page = await openGamePage(connected.context)
    await minimizeChrome(connected.context, page)
    const initial = await tickerStatus(page)
    if (initial.status !== 200 || !Array.isArray(initial.ticker?.items)) {
      throw new Error(`Capital Rift session is not available (HTTP ${initial.status || 'network error'}). Sign in through the Chrome window, then rerun this command.`)
    }

    const ticker = initial.ticker
    const items = ticker.items.filter((item) =>
      item?.kind === 'item' && typeof item.id === 'string' && /^[A-Z0-9_]{1,80}$/.test(item.id)
    )
    if (!items.length) throw new Error('Ticker contained no usable item quotes.')
    console.log(`Authenticated ticker received. Collecting ${items.length} item order books with ${REQUEST_DELAY_MS} ms between requests.`)

    const orderBooks = []
    const failed = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const result = await page.evaluate(async (itemId) => {
        try {
          const response = await fetch(`/api/market/book?commodity=${encodeURIComponent(itemId)}`, {
            credentials: 'same-origin',
            cache: 'no-store'
          })
          if (!response.ok) return { status: response.status }
          return { status: response.status, book: await response.json() }
        } catch (error) {
          return { status: 0, error: error instanceof Error ? error.message : String(error) }
        }
      }, item.id)

      if (result.status === 200 && result.book?.commodity === item.id
        && (Array.isArray(result.book.bids) || Array.isArray(result.book.asks))) {
        orderBooks.push(result.book)
      } else {
        failed.push(`${item.id} (HTTP ${result.status || 'network error'})`)
      }

      if ((index + 1) % 10 === 0 || index === items.length - 1) {
        console.log(`Order books: ${index + 1}/${items.length} checked, ${orderBooks.length} received.`)
      }
      if (index < items.length - 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, REQUEST_DELAY_MS))
    }

    if (!orderBooks.length) throw new Error('No order books were returned; ticker references were left unchanged.')

    const { url: bundleUrl, text: bundle } = await currentBundle(page)
    const { itemImages, machineImages } = previous?.bundleUrl === bundleUrl
      ? { itemImages: [], machineImages: [] }
      : await collectImages(bundle, bundleUrl)
    if (previous?.bundleUrl === bundleUrl) console.log('Game artwork is unchanged; no image files need uploading.')
    const syncUrl = new URL(PLANNER_SYNC_URL)
    if (syncUrl.protocol !== 'https:' && syncUrl.hostname !== 'localhost' && syncUrl.hostname !== '127.0.0.1') throw new Error('The refresh destination must use HTTPS.')
    if (syncUrl.protocol === 'https:' && !process.env.PRICE_SYNC_TOKEN) throw new Error('PRICE_SYNC_TOKEN is missing from .env.')
    const payload = JSON.stringify({ ticker, orderBooks,
      ...(itemImages.length ? { itemImages } : {}),
      ...(machineImages.length ? { machineImages } : {}) })
    if (payload.length > 12_000_000) throw new Error('The combined refresh payload exceeds the receiver limit.')
    console.log(`Uploading ${orderBooks.length} books, ${itemImages.length} item images, and ${machineImages.length} machine images in one request (${Buffer.byteLength(payload)} bytes).`)
    let response
    try {
      response = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.PRICE_SYNC_TOKEN ? { 'x-price-sync-token': process.env.PRICE_SYNC_TOKEN } : {}) },
        body: payload
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the planner at ${syncUrl.href}. (${detail})`)
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.statusMessage || `Planner sync endpoint returned HTTP ${response.status}.`)

    await mkdir(dirname(LAST_SUCCESS_FILE), { recursive: true })
    await writeFile(LAST_SUCCESS_FILE, JSON.stringify({ at: new Date().toISOString(), quoteAsOf: result.quoteAsOf, bundleUrl }) + '\n')
    console.log(`Saved ${result.orderBookCount}/${result.quoteCount} order books, ${result.itemImageCount} item images, and ${result.machineImageCount} machine images. Quote timestamp: ${result.quoteAsOf}.`)
    if (failed.length) console.warn(`${failed.length} books failed; first failures: ${failed.slice(0, 10).join(', ')}`)
  } catch (error) {
    console.error(`Game refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    // The signed-in profile is saved on disk; close this browser after the sync run.
    if (browser) await closeChrome(browser)
  }
}
