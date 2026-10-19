# CapitalRift Factory Planner — Project Plan

**Status as of 2026-10-19:** functional local planner with an optimized calculation path, regression-tested production solver, live public market quotes, and local plan recovery tools. The project is not integrated with capitalrift.com or deployed publicly.

## Goal

Build an unofficial Capital Rift production planner that turns desired output rates into an understandable, editable factory network. Players should be able to inspect recipe dependencies, machine counts, imports, surplus, and the value of market-visible products while keeping control of their plans.

## Delivered

### Data and catalogue

- Normalized the community recipe data in SQLite; the current snapshot contains 346 items, 264 recipes, 768 ingredient lines, and 7 changelog entries.
- Stored source revision, retrieval time, row counts, and SHA-256 digest for each import.
- Added read-only Nuxt routes for recipes and source metadata.
- Categorized and searchable recipe catalogue with a themed scrollbar and drag-to-graph support.
- Import now runs transactionally and preserves prior import records. Each successful import archives its source JSON and a manifest under `data/archive/` for review/rollback.
- Displays stale catalogue age in the planner.

### Planner and calculations

- Added Network Graph, Tree List, Items, Buildings, Targets, and Prices views.
- Added grid canvas, zoom, right-button panning, selection box, multi-selection/movement, and automatic layout with shared producers.
- Generates ingredient chains, shares producers by output, rounds machine counts up to meet demand, and updates shared upstream requirements.
- Shows required external inputs and surplus; supports estimated imported amounts and shortcuts to inspect shortages.
- Moved production math into a pure utility module and replaced repeated recipe, node, and graph scans with indexes and adjacency maps. Port measurements are cached and updates coalesced to reduce layout work.
- Added regression tests for machine rounding, shared demand, partial supplies, surplus, duplicate-output merging, and stale/mismatched links.
- Added undo/redo, clear-plan confirmation, and JSON plan import/export. Plans continue to autosave in browser storage.

### Prices

- Added a server-cached endpoint and Prices view for live quotes from the public Capital Rift market ticker.
- Shows ticker, quote, 24-hour traded units, source link, and server timestamp; refreshes on demand and caches briefly.
- The public feed contains only its current top-mover quotes, not a full catalogue price list. Missing items are left unpriced; no whole-plan valuation is shown yet.

## Remaining work and full plan

### 1. Finish performance work

- Profile large plans and slow devices in a browser; record representative plan sizes and timings before and after changes.
- Add a larger synthetic solver regression case and performance budget once baseline measurements exist.
- Virtualize or progressively render the recipe catalogue and large tree/table views if profiling shows the DOM is a bottleneck.
- Split the large `app/app.vue` component into focused graph, target, table, market, and state modules without changing planner behavior.
- **Done when:** agreed large-plan scenarios remain responsive and profile traces identify no unaddressed dominant bottleneck.

### 2. Validate production rules

- Confirm how recipe rates, batches, partial suppliers, external inputs, surplus, and whole-machine rounding should match in-game results.
- Test real examples across short and deep chains, shared ingredients, multiple outputs, deleted branches, and alternative producers.
- Decide how a shared product with multiple valid recipes is selected. The output search currently chooses the first catalogue recipe; the graph still permits manual recipe nodes.
- **Done when:** an owner-reviewed example set passes repeatably and recipe-choice behavior is agreed.

### 3. Complete live pricing

- Confirm that the public ticker endpoint is a supported and stable source, document its fields and update semantics, and confirm any reuse conditions.
- Clarify what the game’s quote represents (currency and unit basis) before presenting revenue or cost calculations.
- Add plan value only for products with current quotes, clearly mark the priced subset, and specify how a plan’s production rates map to traded units.
- Add feed health, stale/error state, and monitoring appropriate to the chosen host.
- **Done when:** price meaning and source are confirmed, and calculations show exact coverage, units, and as-of time.

### 4. Improve plan inspection and portability

- Add a compact summary mode and stronger collapse/focus controls for large production trees.
- Support recipe preference selection without adding a building selector to the output search row.
- Exercise undo/redo, import/export, and local persistence through browser interaction, including malformed files and recovery cases.
- Consider stable shareable plan files or links; keep cloud saves out until privacy and retention decisions are made.
- **Done when:** users can revise, inspect, transfer, and recover a large plan without losing work.

### 5. Data governance and launch readiness

- Confirm permission and attribution terms for copied recipe data and any game artwork; replace assets without clear terms.
- Review keyboard navigation, screen reader labels, contrast, mobile layouts, and supported browsers.
- Decide whether plans remain browser-local or move to accounts; define privacy, retention, deletion, and access controls before server storage.
- Choose hosting and integration with capitalrift.com; prepare staging, automated updates, monitoring, backup, and rollback.
- **Done when:** the site owner approves data use and an accessible staging release with a maintainable update and rollback process.

## Decisions still open

1. Who can validate representative production chains against current in-game behavior?
2. Are public ticker quotes supported for automated use, and what exactly do price and volume units mean?
3. Should recipe choices be per output, per item across the whole plan, or both?
4. Should plans remain local, or should users have a sharing or account-backed option?
5. What reuse terms apply to upstream recipe data and game artwork?
6. What hosting, domain, deployment, and monitoring process should be used?

## Completion criteria

- Production calculations match an agreed in-game example suite and remain covered by automated regression tests.
- Catalogue and live price data have confirmed terms, visible provenance, age/health information, and a reviewable refresh path.
- Large plans stay responsive, navigable, accessible, and recoverable across supported browsers.
- Data, privacy, hosting, monitoring, and rollback decisions are approved before public launch.
