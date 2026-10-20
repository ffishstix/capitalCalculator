# One-command game refresh

The website reads saved prices and game artwork from Cloudflare D1. Run the collector on this computer when new data is needed. It uses a dedicated, signed-in Chrome profile; Chrome is minimized during collection and closes afterward. One JSON request uploads the collected market snapshot and any changed game artwork to `POST /api/refresh`.

## First-time setup

1. Install dependencies with `npm install`.
2. Keep the ignored `.env` with `PRICE_SYNC_TOKEN` matching the Pages secret. The existing `PLANNER_SYNC_URL` may point to the retired `/api/prices/sync` path; the collector always uses `/api/refresh` on the same origin.
3. Run `npm run prices:login`. Complete Google sign-in in the normal Chrome window. The collector verifies the game ticker, then leaves Chrome open for you to close. It does not request or copy a password or session cookie.
4. Run `npm run refresh:all`. The collector opens the saved profile minimized, gathers the data, uploads one JSON payload, writes an ignored local success marker, and closes Chrome. If the game session has expired, sign in again with `npm run prices:login`.

The browser session stays in `.capitalrift-session-profile/`, which is ignored by Git. Validated image copies live in the ignored `.tmp/game-image-cache.sqlite`; the tracked development database is not changed by this command. The local success marker is `.tmp/refresh-last-success.json`. A repeat run within one hour stops before opening Chrome; the receiver also enforces one hour between successful attempts. There is no recurring Windows task or Cloudflare Cron Trigger. The old separate price, machine-image, item-image, SQL-export, and bookmarklet refresh commands have been retired. Saved price history is retained.

## What the single run collects

- The signed-in game ticker and each item's order book. The game build calls `/market/book?commodity=...` for one commodity at a time; no bulk book route was found in the inspected client code. The collector therefore still makes per-item **game reads**, paced one second apart by default. Set `CAPITALRIFT_REQUEST_DELAY_MS` only if the game's allowed request cadence is confirmed.
- The current game bundle and its item and machine image references. Valid local image copies are reused. If the bundle URL is unchanged since the last successful upload, no images are fetched or uploaded. On the first combined run or a changed bundle, the payload includes all validated catalogue item and machine images. Furniture PNGs are reduced to WebP for D1.
- A single upload to the planner. The receiver validates the ticker, books, image IDs, formats, checksums, and catalogue coverage, then updates market and image tables together. The site never receives the Chrome profile, Google credentials, or game session cookies. The server token authenticates uploads to this site only.

The Pages endpoint accepts one combined request and batches its D1 queries. It uses bounded image groups so a full artwork upload stays within D1's per-query size and query-count limits. Existing machine PNGs in `public/machines` remain a fallback until current machine images are present in D1. Item and machine image URLs are served from D1 after upload.

## Checking the result

`npm run refresh:all` prints the number of books and images accepted. The public Prices page shows the saved quote time and order-book coverage. The **Check for due update** button only reloads saved data; it does not run the collector. You can also inspect `GET /api/prices`, `GET /api/prices/history`, and the item and machine image URLs. Raw bid/ask history keeps missing sides; only displayed valuations use the opposite side as a proxy.

If the upload fails, no success marker is written. A retry may reuse images already collected locally. If Pages returns HTTP 429, wait until the server's one-hour cooldown passes. To force a complete artwork upload after the cooldown, remove only `.tmp/refresh-last-success.json`; do not remove the saved Chrome profile or price history.

## Hosting the collector later

The game's authenticated ticker returned HTTP 401 to an unsigned server request on 2026-10-20. A Cloudflare Worker cannot inherit this computer's Chrome session. A supported read-only game API credential would allow an hourly [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) to replace the local collector. The current 349 per-item game requests would exceed the [Workers Free limit of 50 subrequests per invocation](https://developers.cloudflare.com/workers/platform/limits/) unless the game offers a bulk endpoint. Remote browser automation would also require a separate signed-in session and enough [Browser Run allowance](https://developers.cloudflare.com/browser-run/limits/). No hosted collector is configured.

## Troubleshooting

- **Chrome does not open:** install Google Chrome or set `CHROME_PATH` to its executable.
- **Ticker returns 401:** run `npm run prices:login` and complete sign-in in the opened Chrome window.
- **Upload returns 403:** check that `.env` has the current `PRICE_SYNC_TOKEN` and the Pages secret matches.
- **Upload returns 429:** wait until one hour after the previous server attempt.
- **A different planner address is needed:** set `PLANNER_SYNC_URL` to that site's origin or old sync URL; the collector uses its `/api/refresh` route.
