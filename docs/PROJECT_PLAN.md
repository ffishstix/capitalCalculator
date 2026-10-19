# CapitalRift Factory Planner — Project Plan

**Status as of 2026-10-19:** an interactive local factory-planning prototype is implemented. The project is not yet integrated with capitalrift.com or deployed publicly.

## Goal

Build an unofficial Capital Rift crafting planner that helps players choose products and rates, see the machine network needed to make them, understand imported materials and surplus, and later compare production value using price data.

## Delivered so far

### Catalogue and data layer

- Imported the community `capitalrift-tools` factory catalogue and changelog into SQLite: 346 items, 264 recipes, 768 ingredient lines, and 7 changelog entries.
- Added source revision, retrieval time, counts, and SHA-256 metadata to the import process.
- Added read-only Nuxt API routes for the recipe catalogue and import metadata.
- Added a searchable recipe catalogue with visible categories and a dark themed interface.

### Planner and production graph

- Added an infinite-feeling, grid-snapped network canvas with recipe nodes, material connections, zoom controls, and right-button panning.
- Added node selection, a visible selection box, multi-node movement, catalogue drag-and-drop, and automatic graph arrangement.
- Added automatic ingredient-chain expansion toward raw resources. Generated producers are shared across branches and consolidated by output item, and upstream machine counts respond to connected demand.
- Added deletion-aware chain expansion: a missing child can be generated again without rebuilding already present branches.
- Added the **Network Graph**, **Tree List**, **Items**, **Buildings**, and **Targets** views.
- Added Targets outputs and rates, imported-input estimates, graph-generation options, and persistent browser-local plan settings.
- Added live machine/connection summaries, external input requirements, item balances, and surplus output.
- Added a **Prices** tab with a future-work placeholder.

### Current limits

- Plans live in one browser's local storage; there is no account, cloud save, URL sharing, or cross-device sync.
- The Targets search currently uses the first available recipe for the selected product. Recipe variants are not selectable in the target flow.
- Catalogue refresh is a manual snapshot-and-import process; there is no scheduled source check or update notification.
- The data source has no explicit license file. Rights and attribution terms need confirmation before public redistribution.
- The app is still a prototype: calculation behavior, edge cases, accessibility, mobile layout, and production hosting need more review.

## Recommended roadmap

### 1. Validate the solver and lock its rules

- Write down the expected meaning of recipe rates, batches, machine counts, imported inputs, connected demand, and surplus.
- Check representative short and long chains, shared ingredients, multiple outputs, deleted children, multiple requested products, and recipes with alternative producers.
- Add automated tests for demand aggregation, machine rounding, one producer per output, cycles, and surplus/external-input calculations.
- Decide how to handle conflicting recipe variants when a product is shared across chains; expose a deliberate recipe preference if needed.
- **Done when:** agreed examples produce repeatable results and solver invariants are covered by tests.

### 2. Define and build the Prices view

- Decide which price types matter (for example, vendor value, market value, or buy/sell price), the currency, units, update cadence, and authoritative source.
- Record source, retrieval date, and any region/server context with each price value; do not infer values from item names.
- Add a versioned price-data schema and importer only after the source and reuse terms are clear.
- Show per-item prices and calculated plan value, with explicit handling for missing or stale values.
- **Done when:** a user can inspect the provenance and age of price data and understand how the plan total was calculated.

### 3. Improve planner workflows

- Let users choose among valid recipes for an output without reintroducing a building selector into the output search row.
- Improve large-tree navigation with collapse/expand, focus on selected branches, and compact summary modes.
- Make import limits and shortages actionable in the graph and in the item table.
- Add undo/redo and a clear-plan confirmation, then consider export/import or shareable plans.
- **Done when:** users can create, revise, inspect, and recover a medium-sized plan without losing work or getting lost in the graph.

### 4. Strengthen data updates and provenance

- Document an approved upstream refresh procedure and retain each imported source revision for comparison or rollback.
- Add a visible catalogue “as of” indicator and a clear stale-data/update state.
- Confirm permission to reuse and redistribute recipe data and any game artwork; prefer original icons or assets with verified terms.
- **Done when:** every catalogue value can be traced to an approved source revision and refreshes can be reviewed and rolled back.

### 5. Prepare for wider use

- Split the large planner component into focused graph, target, table, and calculation modules.
- Review keyboard access, screen reader labels, contrast, responsive layouts, and browser compatibility.
- Decide whether plans should remain local or move to an account-backed service; if server saves are introduced, define privacy, retention, deletion, and access controls first.
- Choose hosting and integration with capitalrift.com, add staging, and prepare monitoring and rollback.
- **Done when:** the site owner approves an accessible staging deployment and a maintainable support/update process.

## Decisions still open

1. Who validates solver output against in-game behavior?
2. Which price source and price definition should the Prices view use?
3. Should users be able to select alternative recipes, and how should shared products resolve recipe conflicts?
4. Should plans remain browser-local, or should users be able to export, share, or sync them?
5. What reuse terms apply to the upstream catalogue and game-related names or artwork?
6. What hosting, domain, and deployment process should be used for capitalrift.com?

## Project completion criteria

- Solver rules are documented and validated against agreed examples, with automated regression coverage.
- Catalogue and price data are sourced, attributed, refreshable, and presented with clear as-of information.
- Planner workflows are accessible and responsive, including large-graph navigation and safe plan persistence.
- Data reuse terms, privacy decisions, hosting, monitoring, and rollback are approved before public launch.
