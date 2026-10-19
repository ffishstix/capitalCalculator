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

- **Network Graph:** place recipes from the searchable, categorized catalogue or drag them onto the graph; snap to grid, pan by right-dragging, select multiple nodes, and move a selection together.
- **Production chains:** expand recipe inputs toward raw resources, reuse and consolidate producers by output item, and resize upstream machines when connected demand changes.
- **Planner views:** Tree List, Items, Buildings, Targets, and Prices summarize the graph and market. Targets lets you search for output items, set rates, identify imported inputs, and generate a production chain. Prices shows current quotes from the public Capital Rift market ticker; it currently covers only the ticker's top movers, not every crafting item.
- **Live summaries:** review machine and connection totals, external inputs, item balances, and surplus output.
- **Plan recovery:** plans autosave in browser storage and can be undone/redone, cleared with confirmation, or exported/imported as JSON. Plans are not shared or synchronized between devices.
- **Solver performance:** recipe, node, and adjacency lookups are indexed; graph layout avoids repeatedly scanning all nodes. Calculation utilities have automated regression coverage.
- **Live prices:** the Prices view shows ticker, market quote, 24-hour traded units, source, and timestamp. Quotes are fetched from Capital Rift's public site and briefly cached. Items missing from the current feed are unpriced, and no full plan value is calculated.

## Recipe data

The catalogue snapshot is under `data/source/`. It was imported from [mrawsky/capitalrift-tools](https://github.com/mrawsky/capitalrift-tools), specifically `factory-catalog.json` and `changelog.json`. The current database contains 346 items, 264 recipes, 768 ingredient lines, and 7 changelog entries. Import metadata records the source revision, retrieval time, row counts, and a SHA-256 digest. The source changelog reports that recipe data was checked against game build V448 on 2026-10-17.

To refresh the catalogue, replace the source JSON snapshots and `source-revision.txt` with a reviewed upstream snapshot, then run `npm run db:import`. The importer refreshes SQLite transactionally, retains import metadata, and archives each source snapshot plus a manifest under `data/archive/`. Verify important production results in game after a source update.

The upstream repository has no explicit license file. Before distributing copied data, confirm reuse and attribution terms with its maintainer. Capital Rift names and assets belong to their owners; this is an unofficial community project.

## Project files

- `app/app.vue` — planner interface, graph interactions, production chain logic, and summary views.
- `server/api/recipes.get.ts` — recipe catalogue API backed by SQLite.
- `server/api/meta.get.ts` — imported-source metadata API.
- `server/utils/database.ts` — SQLite access.
- `database/schema.sql` — normalized schema for items, recipes, ingredients, imports, and changelog.
- `scripts/import-data.mjs` — transactional importer for upstream JSON snapshots.
- `app/utils/production-solver.js` — indexed production demand, summary, and duplicate-output calculations.
- `server/api/prices.get.ts` — short-cache proxy for public market quotes.
- `tests/production-solver.test.js` — automated calculation regression checks.
- `data/source/` — dated source snapshots and revision information.
- `docs/PROJECT_PLAN.md` — delivered scope, open decisions, and suggested roadmap.
- `templates/` — project planning templates.

## Next steps

See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the full roadmap. Immediate priorities are profiling large plans in a browser, validating representative production chains in game, confirming the live ticker's stability and price units, and reviewing upstream data reuse terms before public launch.
