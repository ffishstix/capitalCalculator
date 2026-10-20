import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE_DIR = resolve(PROJECT_ROOT, '.capitalrift-session-profile')
const GAME_ORIGIN = 'https://play.capitalrift.com'
const TICKER_PATH = '/api/market/ticker'
const PLANNER_SYNC_URL = process.env.PLANNER_SYNC_URL || 'http://localhost:3000/api/prices/sync'
const REQUEST_DELAY_MS = Number.isFinite(Number(process.env.CAPITALRIFT_REQUEST_DELAY_MS))
  ? Math.max(0, Number(process.env.CAPITALRIFT_REQUEST_DELAY_MS))
  : 1_000
const LOGIN_WAIT_MS = 10 * 60 * 1_000
const LOGIN_POLL_MS = 10_000
const DEBUGGING_PORT = Number(process.env.CAPITALRIFT_CHROME_DEBUG_PORT || 9228)
const DEBUGGING_URL = `http://127.0.0.1:${DEBUGGING_PORT}`

const mode = process.argv[2]
const bypassCooldown = process.argv.includes('--bypass')

if (!['login', 'refresh'].includes(mode)) {
  console.error('Usage: npm run prices:login | npm run prices:refresh [-- --bypass]')
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

async function refresh() {
  let browser
  let context
  try {
    const connected = await connectGameBrowser({ minimized: true })
    browser = connected.browser
    context = connected.context
    const page = await openGamePage(context)
    await minimizeChrome(context, page)
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

    const syncUrl = new URL(PLANNER_SYNC_URL)
    if (bypassCooldown) syncUrl.searchParams.set('bypass', '1')
    console.log(`Saving ${orderBooks.length} order books to ${syncUrl.origin}…`)
    let response
    try {
      response = await fetch(syncUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', ...(process.env.PRICE_SYNC_TOKEN ? { 'x-price-sync-token': process.env.PRICE_SYNC_TOKEN } : {}) },
        body: JSON.stringify({ ticker, orderBooks })
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not reach the planner at ${syncUrl.href}. Make sure npm run dev is running and PLANNER_SYNC_URL points to its /api/prices/sync endpoint. (${detail})`)
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.statusMessage || `Planner sync endpoint returned HTTP ${response.status}.`)

    console.log(`Saved ${result.orderBookCount}/${result.quoteCount} order books. Quote timestamp: ${result.quoteAsOf}.`)
    if (failed.length) console.warn(`${failed.length} books failed; first failures: ${failed.slice(0, 10).join(', ')}`)
  } catch (error) {
    console.error(`Price refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    // The signed-in profile is saved on disk; close this browser after the sync run.
    if (browser) await closeChrome(browser)
  }
}
