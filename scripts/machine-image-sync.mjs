import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = 'https://play.capitalrift.com'
const port = Number(process.env.CAPITALRIFT_CHROME_DEBUG_PORT || 9228)
const debugUrl = `http://127.0.0.1:${port}`
const profile = resolve(root, '.capitalrift-session-profile')
const catalog = JSON.parse(readFileSync(resolve(root, 'data/source/factory-catalog.json'), 'utf8'))
const stations = [...new Set(Object.values(catalog.recipes).map(recipe => recipe.station))].sort()

function chromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [process.env.CHROME_PATH, process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && resolve(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')]
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
    const response = await fetch(`${debugUrl}/json/version`)
    if (!response.ok) throw new Error('Chrome debugging port is unavailable')
  } catch {
    const child = spawn(chromeExecutable(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--start-minimized', origin], { detached: true, stdio: 'ignore' })
    child.unref()
    launched = true
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${debugUrl}/json/version`)
        if (response.ok) break
      } catch {}
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
    }
  }
  const browser = await chromium.connectOverCDP(debugUrl)
  return { browser, launched }
}

async function closeLaunchedBrowser(browser) {
  try {
    const session = await browser.newBrowserCDPSession()
    await session.send('Browser.close')
  } catch {
    await browser.close().catch(() => {})
  }
}

async function main() {
  let browser
  let launched = false
  try {
    ;({ browser, launched } = await connect())
    const context = browser.contexts()[0]
    const page = context.pages().find(candidate => candidate.url().startsWith(origin)) ?? context.pages()[0] ?? await context.newPage()
    if (!page.url().startsWith(origin)) await page.goto(origin, { waitUntil: 'domcontentloaded' })
    const authorized = await page.evaluate(async () => {
      const response = await fetch('/api/market/ticker', { credentials: 'same-origin', cache: 'no-store' })
      return response.status
    })
    if (authorized !== 200) throw new Error(`Saved game session returned HTTP ${authorized}. Run npm run prices:login first.`)

    let mainBundle = (await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)))
      .find(url => /^https:\/\/play\.capitalrift\.com\/assets\/main-[A-Za-z0-9_-]+\.js$/.test(url))
    if (!mainBundle) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      mainBundle = (await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)))
        .find(url => /^https:\/\/play\.capitalrift\.com\/assets\/main-[A-Za-z0-9_-]+\.js$/.test(url))
    }
    if (!mainBundle) throw new Error('Could not find the current game asset bundle.')
    const bundleResponse = await fetch(mainBundle)
    if (!bundleResponse.ok) throw new Error(`Game bundle returned HTTP ${bundleResponse.status}`)
    const bundle = await bundleResponse.text()
    const assets = [...new Set(bundle.match(/\/assets\/[a-z0-9_]+-[A-Za-z0-9_-]+\.png/g) ?? [])]
    const images = []
    for (const station of stations) {
      const matching = assets.filter(path => new RegExp(`^/assets/${station}-[A-Za-z0-9_-]+\\.png$`).test(path))
      if (matching.length !== 1) throw new Error(`Expected one PNG for ${station}; found ${matching.length}.`)
      const sourceUrl = new URL(matching[0], origin).href
      const response = await fetch(sourceUrl)
      if (!response.ok) throw new Error(`${station} image returned HTTP ${response.status}`)
      const contentType = response.headers.get('content-type')?.split(';')[0]
      const image = Buffer.from(await response.arrayBuffer())
      if (contentType !== 'image/png' || image.length < 24 || image.length > 2_000_000
        || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || image.readUInt32BE(16) === 0 || image.readUInt32BE(20) === 0
        || image.readUInt32BE(16) > 2048 || image.readUInt32BE(20) > 2048) {
        throw new Error(`${station} did not return a valid small PNG.`)
      }
      images.push({ station, sourceUrl, image, sha256: createHash('sha256').update(image).digest('hex') })
    }

    const db = new Database(resolve(root, 'database/capitalrift.sqlite'))
    try {
      db.exec(readFileSync(resolve(root, 'database/schema.sql'), 'utf8'))
      const save = db.prepare(`INSERT INTO machine_images (station_id, content_type, image_data, sha256, source_url, fetched_at)
        VALUES (?, 'image/png', ?, ?, ?, ?)
        ON CONFLICT(station_id) DO UPDATE SET image_data=excluded.image_data, sha256=excluded.sha256,
          source_url=excluded.source_url, fetched_at=excluded.fetched_at`)
      const fetchedAt = new Date().toISOString()
      db.transaction(() => { for (const row of images) save.run(row.station, row.image, row.sha256, row.sourceUrl, fetchedAt) })()
      console.log(`Saved ${images.length}/${stations.length} machine images to SQLite (${images.reduce((sum, row) => sum + row.image.length, 0)} bytes).`)
    } finally {
      db.close()
    }
  } finally {
    if (browser) {
      if (launched) await closeLaunchedBrowser(browser)
      else await browser.close()
    }
  }
}

main().catch(error => { console.error(`Machine image refresh failed: ${error.message}`); process.exitCode = 1 })
