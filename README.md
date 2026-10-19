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
- **Planner views:** Tree List, Items, Buildings, and Targets views summarize the graph. The Targets view lets you search for output items, set rates, identify imported inputs, and generate a production chain. Prices is present as a placeholder for future work.
- **Live summaries:** review machine and connection totals, external inputs, item balances, and surplus output.
- **Local persistence:** the current graph and target settings are saved in browser local storage. They are not shared or synchronized between devices.

## Recipe data

The catalogue snapshot is under `data/source/`. It was imported from [mrawsky/capitalrift-tools](https://github.com/mrawsky/capitalrift-tools), specifically `factory-catalog.json` and `changelog.json`. The current database contains 346 items, 264 recipes, 768 ingredient lines, and 7 changelog entries. Import metadata records the source revision, retrieval time, row counts, and a SHA-256 digest. The source changelog reports that recipe data was checked against game build V448 on 2026-10-17.

To refresh the catalogue, replace the source JSON snapshots and `source-revision.txt` with a reviewed upstream snapshot, then run `npm run db:import`. The importer refreshes the SQLite data transactionally. Verify important production results in game after a source update.

The upstream repository has no explicit license file. Before distributing copied data, confirm reuse and attribution terms with its maintainer. Capital Rift names and assets belong to their owners; this is an unofficial community project.

## Project files

- `app/app.vue` — planner interface, graph interactions, production chain logic, and summary views.
- `server/api/recipes.get.ts` — recipe catalogue API backed by SQLite.
- `server/api/meta.get.ts` — imported-source metadata API.
- `server/utils/database.ts` — SQLite access.
- `database/schema.sql` — normalized schema for items, recipes, ingredients, imports, and changelog.
- `scripts/import-data.mjs` — transactional importer for upstream JSON snapshots.
- `data/source/` — dated source snapshots and revision information.
- `docs/PROJECT_PLAN.md` — delivered scope, open decisions, and suggested roadmap.
- `templates/` — project planning templates.

## Suggested next steps

See [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) for the prioritized roadmap. A good next milestone is to validate and test the production solver against representative recipes, then define the data model and rules for the Prices view.
