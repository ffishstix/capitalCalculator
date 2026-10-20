# Command-line market price sync

This is the collection process behind the website's Prices view. For what visitors see, use the [website guide](WEBSITE_GUIDE.md); for the full step-by-step journey, use the [website flow](WEBSITE_FLOW.md).

Capital Rift's market endpoints require its own signed-in game session. A plain Node `fetch` or `curl` request does not inherit Google sign-in, so the CLI uses a dedicated local Chrome profile and makes the API calls from that browser. Chrome is started directly as a regular browser, then the collector attaches to its local debugging connection; it does not use Playwright to launch Chrome or add `--no-sandbox`. Google sign-in remains in Google's normal browser page: the CLI never requests, reads, or saves your Google password.

## First-time setup

1. Install project dependencies with `npm install`.
2. Start the planner in one terminal with `npm run dev` and leave it running at `http://localhost:3000`.
3. In another terminal, run `npm run prices:login`.
4. Chrome opens Capital Rift. Complete Google sign-in in that window. The CLI waits until the game ticker endpoint confirms that the session is active. Chrome remains open and the session is stored in `.capitalrift-session-profile/`.
5. Run `npm run prices:refresh`. It attaches to the open Chrome profile (or opens regular Chrome minimized with that profile if it is closed), reads the ticker and requests each item's order book sequentially with a one-second delay, then posts the collected price data to the local planner. Once the run completes, Chrome closes; the signed-in profile remains saved for the next run.

The browser profile is local and gitignored. It stores the website session as Chrome normally does; no cookie is printed, copied to `.env`, or sent to the planner. Chrome uses local debugging port `9228` so the collector can attach to the same browser; set `CAPITALRIFT_CHROME_DEBUG_PORT` if that port is already in use. If the game session expires, run `npm run prices:login`, finish signing in through the visible Chrome window, then rerun refresh.

## Hourly schedule

For the deployed Pages site, run `npm run prices:refresh:cloud` from this computer after signing in. Its ignored `.env` points to `https://fishstix.uk/api/prices/sync` and contains the matching Pages `PRICE_SYNC_TOKEN` secret. Schedule this command hourly only if this computer and its signed-in Chrome profile will remain available. For local development, use `npm run prices:refresh` with `npm run dev` running. The job is one-shot, minimizes Chrome while collecting data, closes it after saving, and exits. Order-book requests default to a one-second pause; set `CAPITALRIFT_REQUEST_DELAY_MS` to change it (50 ms was tested successfully for all 349 books). If the hourly cooldown needs a deliberate one-run override, use `npm run prices:refresh -- --bypass`.

The deployed receiver requires `PRICE_SYNC_TOKEN` in the request header. Keep the local `.env` private. The bookmarklet is for local imports only; it cannot post directly to Pages without the token.

## What it stores

The receiver stores ticker reference prices in `market_item_quotes`, current bid/ask data in `market_item_order_books`, hourly snapshots in the market history tables, and run outcomes in `market_item_sync_log`. History is retained for 90 days. The sync only reads prices; it does not place trades.

The **Check for due update** button on the website reloads prices from the planner server. It does not launch this command, sign in to the game, or trigger a browser order-book collection. The game item ticker has no item trading volume; the website leaves that field unavailable for game item quotes. Current 30-day trend lines use saved best bids and need at least two snapshots.

The **History** section within Prices reads the saved hourly snapshots through `GET /api/prices/history`; it does not start a sync. Choose a 24-hour, 7-day, 30-day, or 90-day view and move the time slider to inspect what was actually collected. Individual item charts show recorded ticker reference, best bid, and best ask without filling their gaps. Current-plan and selected-output chain valuations use saved bids for sale value and asks for external input costs, expressed per minute. If the needed side is absent, the valuation uses the opposite book side as a proxy at that same timestamp; if both are absent, that flow is incomplete. The optional next-hour item bid estimate still uses actual bids only. See the [History guide](WEBSITE_GUIDE.md#history-inside-prices) for controls and limits.

## Moving collection off this computer

A separate Cloudflare Worker could run hourly with a [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/), fetch the game ticker and per-item books, and post the existing payload to `/api/prices/sync` using the Pages `PRICE_SYNC_TOKEN` secret. The current collector needs a signed-in game session, and an unauthenticated server request to the ticker returned HTTP 401 on 2026-10-20. A Worker does not inherit the local Chrome profile. The preferred next step is to ask the game operator for a supported read-only API credential or service-account flow and confirm the allowed request cadence. If one is available, move collection to a scheduled Worker, store credentials as [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), keep the existing receiver validation and cooldown, and alert on stale or partial updates. Around 349 book requests per run also need sufficient [outbound subrequest allowance](https://developers.cloudflare.com/workers/platform/limits/) or batching supported by the game API; Workers Free currently allows 50 subrequests per invocation and Workers Paid 10,000.

[Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/playwright/) can automate a remote browser and persist browser storage, but that would require moving or creating a signed-in game session in Cloudflare storage and managing expiry and renewed Google sign-in. Its [free browser allowance](https://developers.cloudflare.com/browser-run/limits/) is currently 10 minutes per day, so an hourly run using the collector's one-second delay across roughly 349 books would not fit. Do not copy the current local session into a Worker without an explicit decision to change the user-controlled sign-in approach. A hosted browser service or small server is another option if the game has no service credential, but it has the same session-management issue. No hosted collector is deployed yet; the current cloud refresh still runs from this computer.

The one-time signed-in browser bookmarklet is still available at [`templates/capitalrift-market-sync-bookmarklet.txt`](../templates/capitalrift-market-sync-bookmarklet.txt) for local manual imports.

## Machine images

After signing in, run `npm run images:refresh` to collect the game build's 22 machine PNG thumbnails. The command uses the same local Chrome profile to discover current versioned asset URLs, checks that every planner machine has one valid PNG, then saves the images and their source URLs in SQLite in one transaction. Run `npm run images:export` after refreshing to copy the thumbnails into `public/machines` for the next Pages build. Visitors then receive static PNGs without game credentials. If discovery or a download fails, the previous set stays in the database. These are machine thumbnails, not 3D models or material textures. Confirm artwork redistribution terms for the live site.

## Item images

Run `npm run items:images:refresh` with the saved signed-in Chrome profile to collect current inventory icons and furniture thumbnails. The refresh checks that every catalogue item has an image, validates each download, and saves the complete set to local SQLite in one transaction. Small inlined game icons are decoded from the current bundle; furniture PNGs are resized to WebP for the planner's item displays. The collector currently finds 353 image sources, including all 346 catalogue items and the three additional market tickers.

Run `npm run items:images:export:d1`, then `npx wrangler d1 execute capitalrift-db --remote --file .tmp/item-images-d1.sql --yes` to update the production D1 table. The Pages API serves each saved item image from D1 with an ETag. If the game session expires, use `npm run prices:login` to sign in again; the collector never stores a password or copies cookies.

## Troubleshooting

- **Chrome does not open:** install Google Chrome, then retry `npm run prices:login`.
- **Ticker returns 401:** run `npm run prices:login` and complete Google sign-in in the opened Chrome window.
- **Planner returns 429:** wait for the hourly cooldown or make one deliberate `--bypass` run.
- **A different planner address is needed:** set `PLANNER_SYNC_URL` to its `/api/prices/sync` endpoint and configure a matching `PRICE_SYNC_TOKEN` secret on that host.
- If you previously added `CAPITALRIFT_SESSION_COOKIE` to `.env` for the retired worker, remove it. This CLI does not use that value.
