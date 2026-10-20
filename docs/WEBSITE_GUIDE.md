# Website guide

This describes the verified Pages deployment from 2026-10-20. It is a guide to the running planner, not a specification for in-progress working-tree changes. Follow the [text flow chart](WEBSITE_FLOW.md) for the step-by-step journey and [project plan](PROJECT_PLAN.md) for work that is still proposed.

## What opens in the browser

The page has a top bar, six view tabs, a recipe catalogue on the left, the chosen view in the middle, and a plan overview on the right. The catalogue and overview stay visible while switching views. **History** is a section within Prices, opened from the button beside the **Factory / Prices** heading; it is not a seventh main tab. There are no user accounts or shared plans in the current site.

At startup, the browser restores a saved plan and any local price assumptions, requests the recipe catalogue and import metadata, then requests saved market prices. If the catalogue request fails, the page shows a retry message. Price requests can fail independently; the factory planner can still work without prices. The page checks prices again when Prices opens and hourly while it remains open. A page check reads the planner's database; it does not itself sign in to the game or run the authenticated market collector.

## Header and recipe catalogue

| Control | What it does |
| --- | --- |
| Undo / Redo | Reverses or restores up to 50 recorded plan changes in this open page. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes when focus is outside an editable field. |
| Export | Downloads the plan as a JSON file, including nodes, links, targets, imported inputs, and generation options. |
| Import | Reads a JSON plan smaller than 2 MB, checks its structure and recipe IDs, removes invalid links, and opens the imported graph. An invalid file produces an error message. |
| Clear plan | Asks for confirmation, then removes graph nodes, links, targets, and imported inputs. |
| Catalogue search and categories | Filters recipes by name, label, or building category. Press `/` outside a text field to focus catalogue search. |
| Recipe row | Click to add a machine card or drag it onto the graph. If that product is already present, the existing card is selected instead of adding another producer. |

The catalogue groups recipes by their building (`station`). A recipe contains a product, output batch size, rate per minute, and ingredient quantities. Product and ingredient labels show saved item artwork when available, with an initial as fallback. Machine cards can also show a station thumbnail. The same catalogue feeds target generation, the dependency tree, and the optimizer. The import metadata is used to show the catalogue age.

## Network Graph

- Each card represents one recipe with a whole machine count and an optional stored machine thumbnail. Detailed mode shows the machine count control, output rate, ingredient rates, current buy/sell prices where available, an estimated per-minute card margin, and an **Expand ingredient chain** action where applicable. Compact mode reduces the card to input/output labels and summary figures. The graph detail slider switches between these modes; it is **not** a price history slider.
- Click a recipe in the catalogue or drag it to the canvas. Move cards by dragging; hold Ctrl, Shift, or Command to add to the selection, or drag a selection box across empty canvas. Right-drag pans. Ctrl+wheel zooms around the pointer; toolbar buttons zoom from 60% to 140%, and the center button fits the current layout in view. Cards snap to the grid.
- Each ingredient can use an eligible producer card through its source selector, or **External supply**. The selector only offers producers of the needed item that do not create a cycle. The link reflects the amount that the producer can actually supply; any uncovered amount stays external. Removing a card removes its links.
- **Expand ingredient chain** recursively adds upstream producer cards for ingredients that have recipes, reuses existing suitable producers, avoids cycles, and sizes shared producers for combined demand. Items marked as direct imports are left external. When multiple recipes produce an item, the automatic expansion currently takes the first catalogue recipe unless the optimizer supplied a chosen route.
- INPUT lists the unsupplied material rates; OUTPUT lists requested or unconnected end products. Curved links show producer-to-consumer, external-input, and output-panel flows. The overview reports actual machine total, material connections, external inputs, surplus, and estimated net profit per minute.

## Tree List, Items, and Buildings

| View | What it shows and lets you do |
| --- | --- |
| Tree List | A nested view of product cards and their ingredient requirements. It labels connected supply and external supply. Show or hide a branch, focus a card in the graph, or expand an unfinished chain. |
| Items | Per-minute totals for each item: produced, required, connected, external, and surplus. Search planned items or choose **Set import** on an externally needed item to open Targets → Inputs. |
| Buildings | The building catalogue, optional machine thumbnail, recipe count per building, products made there, and machines currently in the plan. Search buildings or product names. |

All three views describe the current graph; they do not create a separate plan.

## Targets

Targets has **Outputs**, **Inputs**, and **Options** sections.

1. Under Outputs, add one or more items and enter desired items per minute. The product search selects the first matching recipe for the chosen item. Repeated targets for the same product are combined during generation.
2. Under Inputs, choose materials that should be brought in from outside. Enter the available amount per minute to compare it with the graph's external requirement and see a shortfall. The value is an availability indicator; it does not create a producer or reduce the graph's calculated external requirement. Existing connected producers are not removed just because an item is marked as imported.
3. Under Options, choose whether generation arranges the graph automatically and whether to keep and reuse the current plan. When **Keep the current plan** is off, generation starts a new graph while keeping the entered targets and input choices.
4. **Generate production chain** creates or reuses output cards, rounds machine counts up to meet requested rates, recursively adds producers where available, and opens the graph. Some raw or intentionally imported inputs remain external. Output rate can exceed the target because machines are whole.

## Prices

The Prices view uses quotes saved in D1 on the deployed site and SQLite during local development. The page shows the latest known time, refresh status, and how many catalogue items and order books are covered. **Check for due update** reloads the planner's price endpoint; it does not collect from the game. An authenticated game browser sync is needed for new item ticker and order-book data; see [market sync](market-sync.md).

| Price field | Meaning |
| --- | --- |
| Ticker reference | The game's reference value. Graph and plan estimates can use it when neither book side is available; it is labelled as an estimate. |
| Quick buy / best ask | Lowest visible sell ask; used for purchased inputs. If missing, the table shows the bid as an `≈` proxy. |
| Instant sell / best bid | Highest visible buy bid; used for output sale estimates. If missing, the table shows the ask as an `≈` proxy. |
| Suggested sell offer | One cent below the best ask, floored at zero. It is a suggested listing price, not a guaranteed sale. |
| Your buy / Your sell | Browser-local what-if values. They replace the corresponding side in plan and optimizer calculations but do not change saved market quotes. Reset removes both overrides for an item. |
| 30-day sell trend | A small line made from available saved best-bid snapshots. With fewer than two points it says **Collecting**. The line has no interactive time axis. |
| Change since prior snapshot | Percentage change between the current best bid and an earlier saved best-bid snapshot when both exist. |

The game item ticker does not provide item trading volume. Its **Units traded · 24h** cell is therefore blank (`—`), and volume share is unavailable for those items. Public fallback quotes can carry volume and are shown only until a matching game item quote takes precedence.

**Profit and production value** multiplies each surplus item's per-minute rate by its sell price and each external input's rate by its buy price. It uses the opposite book side when the needed side is missing, marked `≈`; if neither book side exists, a saved ticker reference may supply a separately labelled estimate. A missing quote still leaves that flow incomplete. **Most profitable production routes** ranks recipes by estimated one-machine profit per minute. For each ingredient it chooses the cheapest known direct purchase or recursively craftable route, displays the input breakdown and margin, and offers **Add chain** to place the chosen route on the graph. The optimizer uses an opposite-side proxy when needed but does not use ticker-only prices. It does not model machine purchase, fees, taxes, order-book depth, fill chance, unlocks, or competing demand.

### History inside Prices

Select **History** beside **Factory / Prices** to replace the Prices overview with detailed charts, then choose **Individual items** or **Production chains**. While History is open, the heading reads **Factory / History** and that button reads **Prices**. Select **Prices** or **← Price overview** to return to the table, plan economics, and optimizer. The table's 30-day best-bid sparklines remain quick summaries; History reads timestamped saved snapshots for the selected time window. It initially opens to the item view, best bid, and a 30-day range. On small screens, the History section scrolls as one page.

| Control or display | What it does |
| --- | --- |
| 24h / 7d / 30d / 90d | Limits the chart to snapshots within that lookback window. History is retained for at most 90 days; a newly collected item may have much less data. |
| Item selection | Search for any market item and add up to four items. A single item can show ticker reference, highest buy bid (instant sale), and lowest sell ask (quick purchase) together. Use **Price to compare** to pick one side when comparing items; remove selected items with their × buttons. A missing side stays absent; the reference is never substituted for a bid or ask. |
| Comparison scale | With multiple items, **Change from first quote (%)** is the default. Each item starts from its own first available positive quote in the selected range; later values show the percentage change from that quote. Choose **Actual prices ($)** to compare the saved price amounts on one dollar axis. This control does not change or store market prices. |
| Chain selection | Select the whole current graph, or a final output and its linked upstream production path. The chart shows estimated output sales, external input cost, and net margin **per minute** through time, using the selected graph's item rates. An empty graph has no chain to price. |
| Chart and time slider | The chart labels each line and its value at the selected timestamp, displayed in the browser's local time zone. Move over the chart or use the keyboard-accessible range slider to inspect another saved time. Point markers show recorded observations, and lines break across missing prices or gaps longer than 90 minutes. The summary cards count recorded times, show the latest available quote or the number of complete chain points, and show the latest relevant saved time. The chart can show fewer points than the selected range when collection started recently or some snapshots failed. |
| Forecast | **Show estimate when supported** controls a separately labelled next-hour **best-bid estimate** and its error-based range for one selected item. It needs at least 32 fresh, approximately hourly bid observations and a simple trend that beat a no-change baseline in recent checks. It is unavailable for item comparisons, an ask-only or reference-only chart, chains, or unsuitable history. It is not a guaranteed trade price and is not inserted into the plan or chain profit calculations. |

Chain sales multiply each selected output's rate per minute by its saved **best bid**; external input costs multiply each required rate by its saved **best ask**. When a needed side is missing, the calculation uses the opposite side from that same timestamp as a proxy. When both sides are missing, the affected total remains incomplete rather than treating that price as zero. Net margin is sales minus costs. The whole-plan choice uses the current graph's surplus and external inputs. A selected output traces its linked suppliers at the rate that output needs, without selling unrelated surplus from a shared producer. The calculation uses recorded market data, not the browser's **Your buy / Your sell** assumptions or ticker references, and it excludes machine costs, fees, depth, and price impact. The [text flow chart](WEBSITE_FLOW.md#prices--history-step-by-step) traces this path in order.

The forecast uses recent changes between the first and second halves of a 12-observation window, checks the method against a no-change estimate over 12 past predictions, and offers a next-hour projection only if it performed better. Its displayed range derives from recent prediction errors with a minimum width; it is a heuristic, not a measured probability that the next bid will fall inside it.

The chart history depends on separate market collection. An empty plan has no chain to show; a selected range with no snapshots shows a collection message. A history request failure shows an error and can be retried by changing range or reopening History. **Check for due update** and opening History only read the planner's saved database; neither signs in to the game or collects a new order book. See [market sync](market-sync.md) for collecting more hourly snapshots.

## Server routes used by the site

| Route | Current role |
| --- | --- |
| `GET /api/recipes` | Returns recipes, their ingredients, and optional machine and item image URLs. Supports `search` and `station` filters; the page currently loads the full list and filters it in the browser. |
| `GET /api/meta` | Returns the latest catalogue import's date, source, counts, and digest. |
| `GET /api/prices` | Returns saved current quotes, short trend arrays, coverage, source, and refresh status. It does not start a game or public-feed refresh. |
| `GET /api/prices/history?symbols=...&range=...` | Returns ordered timestamped ticker reference, best-bid, and best-ask points for 1–100 unique item symbols. The range is `24h`, `7d`, `30d` (default), or `90d`; an absent value is `null`, never interpolated. Public reference history is a fallback only for a symbol without a saved game ticker quote. Unknown symbols have an empty series. |
| `POST /api/refresh` | Receives one validated JSON payload with the signed-in ticker, order books, and any changed item and machine images. The deployed endpoint requires the private sync token and accepts at most one update per hour. It is called by the local collector, not a page control. |
| `GET /api/machines/{station}/image` | Redirects known stations to exported static PNGs, with a database fallback. The catalogue, graph cards, and Buildings view display available thumbnails. |
| `GET /api/items/{id}/image` | Serves saved item artwork from D1 on Pages or SQLite locally. Item labels use an initial when artwork is unavailable. |

Local development uses `database/schema.sql` to create missing SQLite tables. Production Pages Functions use the D1 binding described in `wrangler.toml`. The [database diagram](DATABASE_DIAGRAM.md) covers current and historical price tables, catalogue imports, and images. `npm run refresh:all` collects prices and artwork in one minimized Chrome run, then sends one JSON upload; unchanged game artwork is reused. Image use and redistribution terms still need review for the live site.

## Saving, data, and failures

- The plan autosaves in this browser's local storage shortly after a change. Price assumptions use a separate local storage key. Neither is an account sync. Undo history lasts only for the open page; export a JSON file for a portable copy.
- The local server reads `database/capitalrift.sqlite`; the deployed server reads D1. Neither stores users' graph plans. The database layout is in [DATABASE_DIAGRAM.md](DATABASE_DIAGRAM.md).
- A missing order-book side uses the opposite side as an `≈` proxy in current and historical valuations. Where current graph economics has no book side at all, it may use the ticker reference as a labelled estimate. A missing item quote remains `$...`. Refresh failures leave the last saved quotes available and show a failure or partial status. A fresh market timestamp is not proof that every item has a fresh book; use the coverage indicator.
- The site is a planning aid. Calculated production and profit need validation against current game rules; price estimates are based on visible order-book tops and may not be executable at the planned quantity.
