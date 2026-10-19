# CapitalRift Crafting Calculator

An unofficial Nuxt 4 factory planner for Capital Rift crafting recipes. Build a production network on a snap grid, arrange machine cards, connect matching outputs to recipe inputs, and review external material needs and leftover production. Plans save in browser local storage; catalogue data is stored in SQLite and served by read-only API endpoints.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

```powershell
npm ci
npm run db:import
npm run dev
```

Open the local URL shown by Nuxt. The imported SQLite database is `database/capitalrift.sqlite`.

## Data and updates

The dated source snapshots are under `data/source/`. They come from [mrawsky/capitalrift-tools](https://github.com/mrawsky/capitalrift-tools), specifically its `factory-catalog.json` and `changelog.json`. The source revision, retrieval date, SHA-256 digest, and row counts are recorded in the database. Re-run `npm run db:import` after refreshing both JSON snapshots and `source-revision.txt`.

The current import contains 346 items, 264 recipes, 768 recipe ingredient lines, and 7 changelog entries. The source changelog says recipe data was checked against game build V448 on 2026-10-17. Verify important results in game after updates.

The source repository has no explicit license file. This local snapshot is included for the requested project with attribution. Confirm reuse and redistribution terms with the source maintainer before publishing copied data. Capital Rift names and assets belong to their owners; this is an unofficial community project.

## Structure

- `app/app.vue` — grid workspace, draggable recipe machines, material connections, and plan summary.
- `server/api/recipes.get.ts` — searchable recipe API backed by SQLite.
- `server/api/meta.get.ts` — imported-source metadata.
- `database/schema.sql` — normalized schema for items, recipes, inputs, imports, and changelog.
- `scripts/import-data.mjs` — transactional importer for the upstream JSON snapshots.
- `data/source/` — dated upstream snapshot and source revision.
- `docs/PROJECT_PLAN.md` — project phases and completion criteria.
