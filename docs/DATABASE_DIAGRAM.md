# Database diagram

The diagram shows the SQLite tables and their relationships. Market snapshot relationships are joined by `symbol` in application queries; they are not enforced by foreign keys in the schema.

```mermaid
erDiagram
    SOURCE_IMPORTS {
        INTEGER id PK
        TEXT source_url
        TEXT repository_url
        TEXT source_revision
        TEXT retrieved_at
        TEXT dataset_sha256
        INTEGER item_count
        INTEGER recipe_count
        INTEGER changelog_count
    }

    ITEMS {
        TEXT id PK
        TEXT name
    }

    MACHINE_IMAGES {
        TEXT station_id PK
        TEXT content_type
        BLOB image_data
        TEXT sha256
        TEXT source_url
        TEXT fetched_at
    }

    ITEM_IMAGES {
        TEXT item_id PK
        TEXT content_type
        BLOB image_data
        TEXT sha256
        TEXT source_url
        TEXT fetched_at
    }

    RECIPES {
        TEXT id PK
        TEXT label
        TEXT station_id
        TEXT product_item_id FK
        REAL batch_output
        REAL rate_per_minute
        INTEGER source_import_id FK
    }

    RECIPE_INGREDIENTS {
        TEXT recipe_id PK, FK
        TEXT item_id PK, FK
        REAL quantity
    }

    CHANGELOG_ENTRIES {
        TEXT id PK
        TEXT published_date
        TEXT game_version
        TEXT title
        TEXT summary
        TEXT evidence
        INTEGER source_import_id FK
    }

    CHANGELOG_CHANGES {
        INTEGER id PK
        TEXT entry_id FK
        TEXT title
        INTEGER sort_order
    }

    CHANGELOG_CHANGE_ITEMS {
        INTEGER id PK
        INTEGER change_id FK
        TEXT description
        INTEGER sort_order
    }

    MARKET_QUOTES {
        TEXT symbol PK
        TEXT name
        REAL price
        REAL units24h
        TEXT quote_as_of
        TEXT fetched_at
        TEXT source_url
    }

    MARKET_REFRESH_LOG {
        INTEGER id PK
        TEXT attempted_at
        TEXT completed_at
        TEXT endpoint
        INTEGER http_status
        INTEGER quote_count
        TEXT outcome
        TEXT error_message
    }

    MARKET_QUOTE_HISTORY {
        INTEGER id PK
        TEXT symbol
        TEXT name
        REAL price
        REAL units24h
        TEXT quote_as_of
        TEXT fetched_at
        TEXT source_url
    }

    MARKET_ITEM_QUOTES {
        TEXT symbol PK
        TEXT name
        REAL price
        REAL day_change_percent
        TEXT quote_as_of
        TEXT fetched_at
        TEXT source_url
    }

    MARKET_ITEM_QUOTE_HISTORY {
        INTEGER id PK
        TEXT symbol
        REAL price
        TEXT quote_as_of
        TEXT fetched_at
    }

    MARKET_ITEM_SYNC_LOG {
        INTEGER id PK
        TEXT attempted_at
        TEXT completed_at
        TEXT endpoint
        INTEGER quote_count
        TEXT outcome
        TEXT error_message
    }

    MARKET_ITEM_ORDER_BOOKS {
        TEXT symbol PK
        REAL best_bid
        REAL best_bid_quantity
        REAL best_ask
        REAL best_ask_quantity
        REAL suggested_sell_offer
        TEXT fetched_at
        TEXT source_url
    }

    MARKET_ITEM_ORDER_BOOK_HISTORY {
        INTEGER id PK
        TEXT symbol
        REAL best_bid
        REAL best_ask
        REAL suggested_sell_offer
        TEXT quote_as_of
        TEXT fetched_at
    }

    SOURCE_IMPORTS ||--o{ RECIPES : supplies
    SOURCE_IMPORTS ||--o{ CHANGELOG_ENTRIES : supplies
    ITEMS ||--o{ RECIPES : produced_as
    RECIPES ||--o{ RECIPE_INGREDIENTS : consumes
    ITEMS ||--o{ RECIPE_INGREDIENTS : ingredient
    CHANGELOG_ENTRIES ||--o{ CHANGELOG_CHANGES : contains
    CHANGELOG_CHANGES ||--o{ CHANGELOG_CHANGE_ITEMS : describes

    MARKET_QUOTES ||--o{ MARKET_QUOTE_HISTORY : symbol_history
    MARKET_ITEM_QUOTES ||--o{ MARKET_ITEM_QUOTE_HISTORY : symbol_history
    MARKET_ITEM_QUOTES ||--o| MARKET_ITEM_ORDER_BOOKS : symbol_order_book
    MARKET_ITEM_ORDER_BOOKS ||--o{ MARKET_ITEM_ORDER_BOOK_HISTORY : symbol_history
```

## Table groups

- **Catalogue:** `items`, `recipes`, and `recipe_ingredients` describe products and production requirements. Recipe ingredients use a composite primary key `(recipe_id, item_id)`.
- **Machine images:** `machine_images` stores optional PNGs by station ID. Recipes and images are matched by `station_id` in queries, without a declared foreign key. `npm run images:refresh` can populate the table from a signed-in game browser; the image route serves a stored image when present. The catalogue, graph cards, and Buildings view display available thumbnails.
- **Item images:** `item_images` stores WebP or PNG artwork by game item ID, including items outside the current recipe snapshot. It has no declared foreign key so catalogue reimports do not remove saved images. The signed-in collector saves images locally; a generated SQL import copies them to production D1. `/api/items/{id}/image` serves them to every item display.
- **Source tracking:** `source_imports` records imported catalogue snapshots and their revisions. Each recipe and changelog entry points to the import it came from.
- **Changelog:** entries contain ordered changes, which in turn contain ordered descriptions.
- **Legacy market feed:** `market_quotes`, `market_quote_history`, and `market_refresh_log` store public reference prices and refresh attempts.
- **Game item market:** `market_item_quotes`, `market_item_quote_history`, `market_item_order_books`, `market_item_order_book_history`, and `market_item_sync_log` store ticker references, executable best bid/ask snapshots, and sync history.

The market history tables enforce uniqueness on `(symbol, quote_as_of)`. The schema does not declare symbol foreign keys between market tables, so an order-book or history row can exist even if its current quote row is absent.

The Prices **History** view reads these existing snapshot tables through `GET /api/prices/history`. It joins reference and order-book observations at their saved timestamps; absent bid or ask values remain missing. Chain totals and the optional next-hour bid estimate are calculated for display and are not stored as new database tables.
