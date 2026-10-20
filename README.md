# CapitalRift Factory Planner

An unofficial Nuxt 4 production planner for Capital Rift. Search the crafting catalogue, place recipes on a grid, connect production machines, and estimate upstream requirements and surplus. Recipe data is stored in SQLite; factory plans are saved locally in the browser.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```powershell
npm ci
npm run db:import
npm run dev
```

Open the local URL shown by Nuxt. The imported SQLite database is `database/capitalrift.sqlite`. For a production build, run `npm run build`, then `npm run preview`.

## Documentation

- [Website guide](docs/WEBSITE_GUIDE.md) — every current screen, control, calculation, and saved state.
- [Website flow](docs/WEBSITE_FLOW.md) — a step-by-step text flow chart from opening the page through planning, pricing, and saving.
- [Market sync](docs/market-sync.md) — signed-in local price collection and troubleshooting.
- [Database diagram](docs/DATABASE_DIAGRAM.md) — SQLite tables and relationships.
- [Project plan](docs/PROJECT_PLAN.md) — delivered work, open decisions, and proposed features.

## Current features

- **Network Graph:** place recipes from the searchable, categorized catalogue or drag them onto the graph; snap to grid, pan by right-dragging, zoom with Ctrl+scroll, select multiple nodes, and move a selection together. A compact/detail slider switches between short item-flow cards and the full machine controls.
- **Graph endpoints:** one shared INPUT panel lists each unsupplied material with its rate and current known price or `$...` when unavailable. One OUTPUT panel lists each planned end product the same way. Each row has its own connector; input and output labels inside machine cards also show known prices.
- **Production chains:** expand recipe inputs toward raw resources, reuse and consolidate producers by output item, and resize upstream machines when connected demand changes.
- **Planner views:** Tree List, Items, Buildings, Targets, and Prices summarize the graph and market. Targets lets you search for output items, set rates, identify imported inputs, and generate a production chain. Prices includes plan surplus/input valuation and a recipe margin optimizer alongside the available market quotes.
- **Live summaries:** review machine and connection totals, external inputs, item balances, and surplus output.
- **Plan recovery:** plans autosave in browser storage and can be undone/redone, cleared with confirmation, or exported/imported as JSON. Plans are not shared or synchronized between devices.
- **Solver performance:** recipe, node, and adjacency lookups are indexed; graph layout avoids repeatedly scanning all nodes. Calculation utilities have automated regression coverage.
- **Market prices:** the game ticker's reference price is distinct from the order book. Profit uses the lowest sell ask as the buy cost for inputs and the highest buy bid as immediate sale revenue for outputs; a suggested sell offer undercuts the lowest ask by one cent, but is not guaranteed to fill. Run `npm run prices:login` to open regular Chrome and sign in through Google, then `npm run prices:refresh` to fetch the ticker and each item's order book through that same browser session and save prices to SQLite. Chrome is launched directly without Playwright browser-launch flags; refresh minimizes and closes Chrome after saving while retaining the signed-in profile. No Google password or session cookie is copied into the planner. See [`docs/market-sync.md`](docs/market-sync.md). The game ticker has no 24-hour item trading volume, so volume-based estimates remain unavailable.
- **Price history:** the **History** button beside **Factory / Prices** opens detailed charts for any saved item or the current production chain. Compare up to four items on one price side using the default percentage change from each item's first quote or actual dollar prices; one item can show ticker reference, best bid, and best ask together. Chain charts show historical sale value, external input costs, and estimated net margin per minute for the whole plan or a chosen output path. Choose a 24-hour, 7-day, 30-day, or 90-day window and move the time slider through saved snapshots. The chart marks recorded points and breaks at missing prices or gaps over 90 minutes. A separate next-hour best-bid estimate appears only when enough suitable item history supports it. Missing bid or ask prices leave chain values incomplete.
- **Machine images:** run `npm run images:refresh` after signing in, then `npm run images:export` before a Pages build. It finds the current game build's 22 machine PNG thumbnails, validates them, and stores them in SQLite with source URLs and hashes. The catalogue, graph, and Buildings view use the exported static PNGs on Pages. Confirm artwork reuse terms before public deployment.
- **Item images:** run `npm run items:images:refresh` with the saved game session. It discovers the current game's inventory WebP icons and furniture thumbnails, validates them, and stores 353 images in SQLite with hashes and source references. Furniture PNGs are resized for the site's small item displays. Run `npm run items:images:export:d1`, then import `.tmp/item-images-d1.sql` into the production D1 database as shown below. Pages serves item images from D1 through `/api/items/{id}/image` in the catalogue, graph, item balances, targets, prices, and history.
- **Profit estimates:** Prices breaks down known surplus revenue and external input cost and ranks fully priced recipes by estimated item margin and one-machine profit per minute. The game item ticker does not supply item trading volume, so item volume-share estimates are unavailable. Users can model separate local buy/sell prices; overrides are stored in their browser and never change market data. Figures exclude machine costs, fees, and price impact.

## Recipe data

The catalogue snapshot is under `data/source/`. It was imported from [mrawsky/capitalrift-tools](https://github.com/mrawsky/capitalrift-tools), specifically `factory-catalog.json` and `changelog.json`. The current database contains 346 items, 264 recipes, 768 ingredient lines, and 7 changelog entries. Import metadata records the source revision, retrieval time, row counts, and a SHA-256 digest. The source changelog reports that recipe data was checked against game build V448 on 2026-10-17.

To refresh the catalogue, replace the source JSON snapshots and `source-revision.txt` with a reviewed upstream snapshot, then run `npm run db:import`. The importer refreshes SQLite transactionally, retains import metadata, and archives each source snapshot plus a manifest under `data/archive/`. Verify important production results in game after a source update.

The upstream repository has no explicit license file. Before distributing copied data, confirm reuse and attribution terms with its maintainer. Capital Rift names and assets belong to their owners; this is an unofficial community project.

## Project files

- `app/app.vue` — planner interface, graph interactions, production chain logic, and summary views.
- `server/api/recipes.get.ts` — recipe catalogue API backed by SQLite.
- `server/api/meta.get.ts` — imported-source metadata API.
- `server/utils/database.ts` — SQLite access.
- `database/schema.sql` — normalized schema for items, recipes, ingredients, imports, changelog, and cached public/game market quote history.
- `scripts/import-data.mjs` — transactional importer for upstream JSON snapshots.
- `app/utils/production-solver.js` — indexed production demand, summary, and duplicate-output calculations.
- `app/utils/price-history.js` — selected-output chain tracing, timestamped chain valuation, and conservative item bid forecast.
- `app/components/PriceHistory.vue` and `app/components/PriceHistoryChart.vue` — History controls, metrics, and charts within Prices.
- `server/api/prices.get.ts` — SQLite-backed current market quote endpoint with catalogue coverage, short trends, and refresh status.
- `server/api/prices/history.get.ts` — timestamped market price history for selected items and time ranges.
- `server/api/prices/sync.post.ts` — validates and stores a signed-in game ticker snapshot; enforces a one-hour interval and logs syncs.
- `server/api/machines/[station]/image.get.ts` — serves a stored machine image when one exists for a station.
- `templates/capitalrift-market-sync-bookmarklet.txt` — credential-free one-shot browser sync for local use.
- `scripts/market-price-sync.mjs` — interactive Chrome sign-in and one-shot authenticated market refresh.
- `scripts/machine-image-sync.mjs` — optional signed-in browser collection of station PNGs into SQLite (`npm run images:refresh`).
- `.capitalrift-session-profile/` — local gitignored Chrome session profile used by the refresh commands.
- `tests/production-solver.test.js` — automated calculation regression checks.
- `data/source/` — dated source snapshots and revision information.
- `docs/PROJECT_PLAN.md` — delivered scope, open decisions, and suggested roadmap.
- `docs/DATABASE_DIAGRAM.md` — ER diagram of the SQLite tables and relationships.
- `docs/WEBSITE_GUIDE.md` — current website behavior and controls.
- `docs/WEBSITE_FLOW.md` — step-by-step text flow chart for the website and price pipeline.
- `templates/` — project planning templates.

## Next steps

See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the full roadmap. Immediate priorities are profiling large plans in a browser, validating representative production chains in game, collecting hourly price snapshots for longer history windows, and reviewing upstream data reuse terms before public launch.

## Cloudflare Pages deployment

The production Pages project is `capitalcalculator` at `fishstix.uk`. Its D1 binding `DB` points to `capitalrift-db`; `wrangler.toml` records the binding and the `dist` build output. The Nuxt server routes use D1 on Pages and the local SQLite file during `npm run dev`.

After editing the site, run:

```powershell
npm test
npm run build
npx wrangler pages deploy dist --project-name capitalcalculator --branch main
```

To refresh the production item image table, run `npm run items:images:export:d1` and `npx wrangler d1 execute capitalrift-db --remote --file .tmp/item-images-d1.sql --yes` before deploying. The SQL import is repeatable and updates images by item ID. Verify coverage with `npx wrangler d1 execute capitalrift-db --remote --command "SELECT count(*) FROM item_images"`.

The first D1 import was performed from the local SQLite catalogue and saved quotes. The live database contains the source catalogue and market snapshots; plans remain in each browser's local storage. Machine PNGs are built as static files under `public/machines`.

For remote market refreshes, the Pages project has a private `PRICE_SYNC_TOKEN` secret and this machine has an ignored `.env` with the matching token and production sync URL. After signing in with `npm run prices:login`, run `npm run prices:refresh:cloud`. The collector reads the game through the signed-in Chrome profile, then posts only market data to Pages. The remote receiver requires the token and limits normal refreshes to once per hour. Keep `.env` private; if it is lost, rotate the Pages secret and local token together.
