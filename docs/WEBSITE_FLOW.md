# Website flow, step by step

This is a text flow chart of the current website. Read from top to bottom; indented branches are choices. The accompanying [website guide](WEBSITE_GUIDE.md) explains every screen and field.

```text
OPEN THE PLANNER
  |
  +--> Browser restores this device's saved plan and price assumptions
  |      (or starts with an empty graph if there is no valid saved plan)
  |
  +--> Browser requests recipe catalogue + import metadata from the server
  |      |
  |      +--> Catalogue fails --> show load error; refresh to retry
  |      |
  |      +--> Catalogue loads --> clean up duplicate output cards,
  |                               discard cards whose recipes no longer exist,
  |                               display searchable recipe list
  |
  +--> Browser requests saved prices from the server
         |
         +--> Quotes load --> show buy/sell labels and price estimates
         +--> Quotes fail --> keep factory planning available; show price error
  |
  v
CHOOSE A WAY TO BUILD THE FACTORY
  |
  +--> A. Manual graph
  |      Search/filter recipes --> click or drag one onto the grid
  |      --> adjust whole-machine count --> choose ingredient source
  |      --> optionally expand upstream ingredient chain
  |
  +--> B. Targets
  |      Add output item(s) + desired items/minute
  |      --> optionally mark direct-import materials and availability
  |      --> choose keep-current-plan and auto-arrange options
  |      --> Generate production chain
  |      --> create/reuse output cards and upstream producers
  |
  +--> C. Prices optimizer
         Search ranked, fully priced recipes --> inspect input route
         --> Add chain --> place chosen buy-or-craft route on graph
  |
  v
FOR EACH MACHINE CARD
  Recipe batch output + per-minute rate + machine count
      --> product output per minute
      --> ingredient demand per minute
      --> connected producer supplies up to available output
      --> uncovered demand becomes an external input
      --> unused produced output becomes surplus
  |
  v
INSPECT THE RESULT
  |
  +--> Network Graph: cards, links, INPUT/OUTPUT panels, machine controls
  +--> Tree List: nested dependencies, external supply, graph focus
  +--> Items: produced / required / connected / external / surplus
  +--> Buildings: recipes, products, machines per building
  +--> Targets: requested outputs, imported items, generation choices
  +--> Prices: saved market quotes, plan economics, recipe optimizer
  |      |
  |      +--> History: item or chain charts from saved snapshots
  |
  v
PRICE CALCULATION (WHEN SAVED ORDER BOOKS HAVE THE NEEDED SIDES)
  External input rate x best ask (or local buy assumption) = input cost/min
  Surplus output rate x best bid (or local sell assumption) = sales/min
  Sales/min - input cost/min = estimated net profit/min
  Missing side --> use opposite book side as an estimate
  Both sides missing --> graph/plan may use ticker reference; otherwise $...
  |
  v
KEEP OR MOVE THE PLAN
  Change --> autosave to this browser
  Undo/Redo --> step through this open page's recent plan snapshots
  Export --> download plan JSON; Import --> validate and load plan JSON
  Clear plan --> confirmation --> erase plan nodes, links, targets, inputs
```

## Prices → History, step by step

```text
OPEN PRICES
  --> choose History beside the Factory / Prices heading
  --> choose a time window: 24 hours, 7 days, 30 days, or 90 days
  |
  +--> INDIVIDUAL ITEMS
  |      Search/select a market item; optionally compare up to four items
  |      --> for one item, start with the best bid; choose ask or reference,
  |          or turn on all three lines together
  |      --> for comparisons, select one price side across items
  |      --> default to each item's change from its first quote (%)
  |          or choose actual saved prices ($)
  |      --> load timestamped snapshots in the chosen window
  |      --> chart the selected side (or all three for one item)
  |      --> show recorded point markers; break lines across missing
  |          prices or gaps longer than 90 minutes
  |      --> move the time slider or focus a chart point
  |      --> read the saved time and available prices at that point
  |      --> optional next-hour bid estimate appears only when enough
  |          recent, regular snapshots support it
  |
  +--> PRODUCTION CHAINS
         Choose the whole current plan or one output and its linked
         upstream production path
         --> find output sale rates and external input rates per minute
         --> request those items' saved bid and ask snapshots
         --> join available prices at the same saved timestamp
         --> output rate x saved bid = estimated sales per minute
         --> external input rate x saved ask = estimated cost per minute
         --> sales - costs = estimated net margin per minute
         --> move the time slider to inspect a saved time and coverage
  |
  +--> IF DATA IS MISSING
         No saved points --> explain that history must be collected
         Missing bid or ask --> use opposite side from that same hour
         Both missing --> leave affected chain value incomplete
         Sparse/stale points or an unreliable trend
         --> withhold the forecast and explain that it is unavailable
```

The chart uses recorded market prices. Browser-local buy/sell what-if values do not rewrite history. Local SQLite and production D1 syncs retain at most 90 days, so a selected window may contain less data than its label suggests.

## How a price reaches the page

```text
Recipe import (reviewed source JSON)
  --> transactional SQLite catalogue import + source record + archive
  --> one-time D1 catalogue load for the current production snapshot
  --> GET /api/recipes and GET /api/meta
  --> catalogue, targets, calculations, and catalogue age in browser

Signed-in game browser + one local collector
  --> game ticker reference prices + per-item order books
  --> current game bundle; reuse unchanged local item/machine images
  --> one token-protected POST /api/refresh on Pages
      (validation, hourly cooldown, sync log)
  --> current quotes/books + hourly history + changed artwork in D1
  --> GET /api/prices
  --> Prices table, graph labels, plan economics, recipe optimizer
  --> GET /api/prices/history for selected symbols and time window
  --> timestamped item charts and chain calculations in History

```

**The website's reload button does not run the signed-in collector.** The local `npm run refresh:all` command is documented in [market-sync.md](market-sync.md). It collects market data and game artwork in one minimized Chrome run, then makes one upload to the site. A normal server request to the game's authenticated ticker cannot use the user's game login.

## How images reach the page

```text
Signed-in game browser + local cached artwork
  --> same JSON upload as market data when the game bundle changes
  --> item_images and machine_images in D1
  --> GET /api/items/{id}/image and /api/machines/{station}/image
  --> previously exported public/machines/*.png only as a fallback

Recipe API provides image URLs when a saved image exists
  --> item artwork in catalogue, graph, targets, tables, and History
  --> machine thumbnails on graph cards and in Buildings
```

The one collector is manual. A changed game bundle triggers an artwork coverage check and upload in the same request. Recipe catalogue imports remain a separate reviewed operation.

## Decision points and limits

1. **Another recipe exists for an ingredient?** Automatic expansion uses the first catalogue recipe unless an optimizer route was selected. The user can manually pick a producer for a card's ingredient.
2. **A producer is shared?** Its machine count is sized for the sum of connected demand. Whole machines are rounded up, so surplus may result.
3. **No recipe exists or direct import is chosen?** The item remains an external requirement. The amount entered as an available import is shown against that requirement; it does not erase it.
4. **A price is missing?** The opposite order-book side becomes an estimate when only one side is missing. Graph and plan figures may use the ticker reference when both sides are absent; the optimizer does not. A missing quote stays incomplete.
5. **Only one saved history point exists?** The Prices table says **Collecting**. History can display the known point, but a trend and next-hour estimate need more suitable snapshots.
6. **A quote row exists without a needed bid or ask?** The opposite side supplies an `≈` proxy for that valuation. Historical item charts continue to show the actual recorded sides, with their gaps.
