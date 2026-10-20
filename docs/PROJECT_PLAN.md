# CapitalRift Factory Planner — Project Plan

**Status as of 2026-10-20:** functional local planner with a regression-tested solver, SQLite-backed recipe and market data, plan-level valuation, local what-if prices, a margin optimizer, and item/chain price history charts. A signed-in game browser ticker has been read and its 349 item prices imported, covering all 346 catalogue items. The project is deployed to Cloudflare Pages at fishstix.uk with D1-backed APIs.

## Goal

Build an unofficial Capital Rift production planner that turns desired output rates into an understandable, editable factory network. Players should be able to inspect recipe dependencies, machine counts, imports, surplus, and the value of market-visible products while keeping control of their plans.

For the current website's screen-by-screen behavior, see [Website guide](WEBSITE_GUIDE.md). For a step-by-step text flow chart, see [Website flow](WEBSITE_FLOW.md). This plan distinguishes delivered features from proposed work.

## Delivered

### Data and catalogue

- Normalized the community recipe data in SQLite; the current snapshot contains 346 items, 264 recipes, 768 ingredient lines, and 7 changelog entries.
- Stored source revision, retrieval time, row counts, and SHA-256 digest for each import.
- Added read-only Nuxt routes for recipes and source metadata.
- Categorized and searchable recipe catalogue with a themed scrollbar and drag-to-graph support.
- Added optional machine PNG storage and a signed-in refresh command; stored thumbnails appear in the catalogue, graph cards, and Buildings view. Artwork reuse terms still need review before public release.
- Import now runs transactionally and preserves prior import records. Each successful import archives its source JSON and a manifest under `data/archive/` for review/rollback.
- Displays stale catalogue age in the planner.

### Planner and calculations

- Added Network Graph, Tree List, Items, Buildings, Targets, and Prices views.
- Added grid canvas, zoom, right-button panning, selection box, multi-selection/movement, and automatic layout with shared producers. The graph includes a compact/detail slider plus one layered INPUT panel and one OUTPUT panel with a port for each listed material.
- Generates ingredient chains, shares producers by output, rounds machine counts up to meet demand, and updates shared upstream requirements.
- Shows required external inputs and surplus; supports estimated imported amounts and shortcuts to inspect shortages.
- Shows known market prices on source, input, and output labels; unavailable prices use `$...` when no quote exists.
- Moved production math into a pure utility module and replaced repeated recipe, node, and graph scans with indexes and adjacency maps. Port measurements are cached and updates coalesced to reduce layout work.
- Added regression tests for machine rounding, shared demand, partial supplies, surplus, duplicate-output merging, and stale/mismatched links.
- Added undo/redo, clear-plan confirmation, and JSON plan import/export. Plans continue to autosave in browser storage.
- Added a screen-by-screen [website guide](WEBSITE_GUIDE.md) and a [step-by-step text flow chart](WEBSITE_FLOW.md) for the current planner and its price data path.

### Prices

- Stores public fallback quotes in SQLite while no authenticated game ticker snapshot exists; attempts are rate-limited to once per 24 hours and recorded in `market_refresh_log`.
- Keeps up to 90 days of quote snapshots in `market_quote_history`, seeds the first history point from the current snapshot, and reports daily change and a 30-day trend as samples accumulate. The Prices view shows quote age, next eligible refresh time, refresh failures, and catalogue coverage.
- Read the game page's `GET /api/market/ticker` in the user's signed-in browser. It returned 349 item prices; a direct server-side request without the browser session returned `401 Unauthorized`.
- Imported a current ticker snapshot into SQLite with 349 market item rows; all 346 catalogue item IDs matched. Quote identifiers are lowercased and mapped to catalogue display names.
- Added `market_item_quotes`, `market_item_quote_history`, and `market_item_sync_log`. Imports retain 90 days of history and are limited to one per hour.
- Added a local sync receiver, a CLI browser-login/refresh flow, and a credential-free bookmarklet. The CLI launches a dedicated Chrome profile for Google sign-in, reads ticker and item order books through authenticated page requests, and posts only the price payload to the local planner; Google credentials and browser cookies are never copied into the planner. The bookmarklet remains available for manual one-time refreshes.
- The ticker's `price` is a reference value, not executable market pricing. The signed-in game currently exposes per-item order books with bids and asks; the Prices table distinguishes the lowest ask (quick buy), highest bid (instant sell), and a suggested one-cent-under-ask offer. Plastic Pellets was verified in the live market at a $1,299.99 best ask and $40.02 best bid during this review.
- Profit now values each produced item at its highest current buy bid, then subtracts each purchased ingredient at its lowest current sell ask. The optimizer uses the same side-specific prices for output sale and input costs. Missing order-book sides remain unpriced instead of falling back to the ticker reference.
- The game ticker includes a day-change percentage but no item trading-volume figure. The Prices table no longer presents missing ticker volume as zero.
- Added a Prices view production economics section with estimated surplus sales, external input costs, net margin per minute, and per-item flow valuations.
- Moved the recipe optimizer into Prices and expanded it to show fully priced recipes, sale price, recursively estimated ingredient cost, unit margin, margin percentage, one-machine profit per minute, per-input cost details, and an action to add the selected chain to the graph. Item volume share is unavailable because the game ticker has no item trading-volume figure.
- Added browser-local buy and sell scenario prices. Overrides recalculate the plan, node margins, and optimizer without changing saved market quotes or making additional requests.
- Added a History section inside Prices, opened beside the Factory / Prices heading. It shows timestamped item reference, bid, and ask charts, comparison of up to four items by percentage change or actual dollar price, and historical per-minute sales, external input costs, and net margin for the whole graph or one output's linked chain. Range controls cover 24 hours through 90 days, with a time slider for inspecting snapshots. Recorded point markers and gaps make missing or widely spaced observations visible.
- Added a dedicated history endpoint for saved item and order-book snapshots. Missing bids and asks stay missing, so incomplete chain valuations are identified instead of shown as zero. A next-hour item bid estimate is shown only when enough fresh, regularly spaced observations support it and remains separate from current profit calculations.
- User reports written developer permission for this personal read-only integration. Confirm the exact permitted request cadence and reuse terms before public deployment.
- The current snapshot prices 346/346 catalogue items. Validate price units, ticker stability, and trade rules before treating estimated production margin as realized profit.

## Remaining work and full plan

### 1. Finish performance work

- The solver regression suite includes a 1,500-node shared network; the latest run completed it in about 10 ms in Node on this development machine. This measures calculation time only, not browser rendering or layout.
- Profile large plans and slower devices in a browser; record representative plan sizes and timings before and after changes.
- Set a repeatable performance budget after browser measurements exist; extend synthetic cases if profiling identifies additional bottlenecks.
- Virtualize or progressively render the recipe catalogue and large tree/table views if profiling shows the DOM is a bottleneck.
- Split the large `app/app.vue` component into focused graph, target, table, market, and state modules without changing planner behavior.
- **Remaining:** browser profiling, UI scalability work if measurements support it, and the component split.

### 2. Validate production rules

- Automated checks cover machine rounding, shared demand, partial supply, surplus, duplicate outputs, stale links, and a 1,500-node network; all six pass.
- Confirm how recipe rates, batches, partial suppliers, external inputs, surplus, and whole-machine rounding match current in-game results.
- Validate real examples across short and deep chains, shared ingredients, multiple outputs, deleted branches, and alternative producers with the owner.
- Decide how a shared product with multiple valid recipes is selected. The output search currently chooses the first catalogue recipe; the graph still permits manual recipe nodes.
- **Remaining:** owner-reviewed game examples and a decision on shared recipe preferences.

### 3. Complete live pricing

- `npm run prices:login` opens standard Chrome directly (without Playwright launch flags) for user-completed Google sign-in. The collector attaches through Chrome's local debugging port and persists the session in an ignored local browser profile. `npm run prices:refresh` reuses the same browser/profile, minimizes Chrome, fetches each book sequentially at one request per second, sends only ticker/order-book data to the planner receiver, then closes Chrome.
- Schedule the one-shot CLI refresh hourly on the same machine as the planner database. If the game session expires, run the login command again; the worker does not automate Google authentication or extract cookies.
- Order books expose best bid/ask and visible quantities, but do not guarantee that a new sell offer fills. A one-cent-under-ask suggestion is only a pricing aid. The game ticker lacks item volume; fees and fill behavior remain unmodeled.
- Confirm price currency/unit basis, endpoint stability, and reuse terms before public deployment. User reports written developer permission for this read-only use; obtain confirmation of production/public distribution scope separately.
- Keep plan valuation limited to known quotes and clearly mark incomplete input/output coverage.
- The app reports refresh failure and serves saved quotes; deployment monitoring remains unconfigured on the selected Cloudflare Pages host.
- The Prices page names the available CLI and bookmarklet collection paths, and its net card checks required bid/ask sides before showing a complete figure.
- **Remaining:** complete a user-driven CLI Google sign-in, collect multiple hourly history points, and add host-specific monitoring. The Pages receiver now requires a private sync token, and `npm run prices:refresh:cloud` posts from the local signed-in Chrome session.

### 4. Keep price history accurate as snapshots accumulate

- **Delivered:** a History button beside Factory / Prices opens a chart layout for items or the current graph. Item mode supports search, comparison of up to four items on a default percentage-change scale or an actual-dollar scale, timestamped ticker reference/bid/ask data, four lookback windows, and a time slider. Chart lines break at missing values or gaps over 90 minutes. Chain mode prices the whole plan or one output with its linked upstream path and labels sale value, external input cost, and net margin per minute. The existing small trend lines remain in the market table.
- **Delivered:** `GET /api/prices/history` reads timestamped saved snapshots for requested symbols and time ranges. The query is bounded, order-book gaps stay missing, and SQLite retains at most 90 days of history at the existing sync cadence.
- **Delivered:** a separately labelled next-hour best-bid estimate appears only when selected item history is fresh and sufficiently regular. It does not become a current quote or enter profit calculations.
- **Remaining:** collect enough real hourly snapshots for useful long-range charts, compare chain totals with representative in-game cases, and assess forecast error once a meaningful history exists. Continue accessibility and mobile review with full 90-day datasets.

### 5. Make the profit optimizer decision-ready

- The optimizer displays sale price, recursive buy-or-craft ingredient cost, margin, one-machine return per minute, and per-input route details. Game item volume share remains unavailable without a verified volume source.
- Separate local buy and sell assumptions update plan economics and optimizer results without changing market data. These are single editable assumptions, not a side-by-side scenario manager.
- Add verified machine/building capital and operating costs, unlock requirements, and throughput limits before estimating payback or feasible capacity.
- Use order-book depth, fees, and price impact to constrain sellable output; top-of-book quantities are visible, but fill probability is not estimated yet.
- Add machine availability, comparable saved scenarios, and controls to pin/exclude alternate recipes after recipe preference rules are agreed.
- Explain which alternate recipe or buy-versus-craft route was selected and why; allow users to pin preferred recipes or exclude routes.
- **Remaining:** authoritative game and market inputs for feasibility, then scenario comparison and route controls.

### 6. Improve plan inspection and portability

- Compact/detail graph mode, collapsible tree branches, graph focus, undo/redo, JSON import/export, and browser-local autosave are implemented.
- Support recipe preference selection without adding a building selector to the output search row.
- Exercise undo/redo, import/export, and local persistence through browser interaction, including malformed files and recovery cases.
- Consider stable shareable plan files or links; keep cloud saves out until privacy and retention decisions are made.
- **Remaining:** browser recovery/accessibility review and owner decision on shareable files or links.

### 7. Data governance and launch readiness

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
