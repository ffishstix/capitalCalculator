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

## Current features

- **Network Graph:** place recipes from the searchable, categorized catalogue or drag them onto the graph; snap to grid, pan by right-dragging, zoom with Ctrl+scroll, select multiple nodes, and move a selection together. A compact/detail slider switches between short item-flow cards and the full machine controls.
- **Graph endpoints:** one shared INPUT panel lists each unsupplied material with its rate and current known price or `$...` when unavailable. One OUTPUT panel lists each planned end product the same way. Each row has its own connector; input and output labels inside machine cards also show known prices.
- **Production chains:** expand recipe inputs toward raw resources, reuse and consolidate producers by output item, and resize upstream machines when connected demand changes.
- **Planner views:** Tree List, Items, Buildings, Targets, and Prices summarize the graph and market. Targets lets you search for output items, set rates, identify imported inputs, and generate a production chain. Prices includes plan surplus/input valuation and a recipe margin optimizer alongside the available market quotes.
- **Live summaries:** review machine and connection totals, external inputs, item balances, and surplus output.
- **Plan recovery:** plans autosave in browser storage and can be undone/redone, cleared with confirmation, or exported/imported as JSON. Plans are not shared or synchronized between devices.
- **Solver performance:** recipe, node, and adjacency lookups are indexed; graph layout avoids repeatedly scanning all nodes. Calculation utilities have automated regression coverage.
- **Market prices:** the signed-in game ticker returned 349 item prices, covering all 346 recipe catalogue items. A current snapshot is stored in SQLite, with 90-day price history and a 24-hour sync limit recorded in `market_item_sync_log`. Follow [`docs/market-sync.md`](docs/market-sync.md) to set up the bookmarklet from `templates/capitalrift-market-sync-bookmarklet.txt`. The public 10-quote feed is used only as a fallback before the first game ticker import. The server does not store or reuse Google/session credentials. Direct server-side requests to the game ticker return `401 Unauthorized`, so future refreshes must originate in the user's logged-in browser. The game ticker does not include trading volume; volume-based estimates remain unavailable for these quotes.
- **Profit estimates:** Prices breaks down known surplus revenue and external input cost, ranks fully priced recipes by estimated item margin and one-machine profit per minute, and compares daily plan rates with reported 24-hour volume. Users can model separate local buy/sell prices; overrides are stored in their browser and never change market data. Figures exclude machine costs, fees, and price impact.

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
- `server/api/prices.get.ts` — SQLite-backed market quote endpoint with catalogue coverage, quote history, and refresh status.
- `server/api/prices/sync.post.ts` — validates and stores a signed-in game ticker snapshot; enforces a 24-hour interval and logs syncs.
- `templates/capitalrift-market-sync-bookmarklet.txt` — credential-free browser bookmarklet for refreshing the game ticker into the local planner.
- `tests/production-solver.test.js` — automated calculation regression checks.
- `data/source/` — dated source snapshots and revision information.
- `docs/PROJECT_PLAN.md` — delivered scope, open decisions, and suggested roadmap.
- `templates/` — project planning templates.

## Next steps

See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the full roadmap. Immediate priorities are profiling large plans in a browser, validating representative production chains in game, collecting a few daily snapshots, and reviewing upstream data reuse terms before public launch.
