PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_imports (
  id INTEGER PRIMARY KEY, source_url TEXT NOT NULL, repository_url TEXT NOT NULL,
  source_revision TEXT, retrieved_at TEXT NOT NULL, dataset_sha256 TEXT NOT NULL,
  item_count INTEGER NOT NULL, recipe_count INTEGER NOT NULL, changelog_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machine_images (
  station_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK(content_type = 'image/png'),
  image_data BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, station_id TEXT NOT NULL,
  product_item_id TEXT NOT NULL REFERENCES items(id), batch_output REAL NOT NULL CHECK(batch_output > 0),
  rate_per_minute REAL NOT NULL CHECK(rate_per_minute >= 0), source_import_id INTEGER NOT NULL REFERENCES source_imports(id)
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id), quantity REAL NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(recipe_id, item_id)
);
CREATE TABLE IF NOT EXISTS changelog_entries (
  id TEXT PRIMARY KEY, published_date TEXT NOT NULL, game_version TEXT, title TEXT NOT NULL,
  summary TEXT NOT NULL, evidence TEXT NOT NULL, source_import_id INTEGER NOT NULL REFERENCES source_imports(id)
);
CREATE TABLE IF NOT EXISTS changelog_changes (
  id INTEGER PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES changelog_entries(id) ON DELETE CASCADE,
  title TEXT NOT NULL, sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS changelog_change_items (
  id INTEGER PRIMARY KEY, change_id INTEGER NOT NULL REFERENCES changelog_changes(id) ON DELETE CASCADE,
  description TEXT NOT NULL, sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL,
  units24h REAL NOT NULL, quote_as_of TEXT NOT NULL, fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_refresh_log (
  id INTEGER PRIMARY KEY, attempted_at TEXT NOT NULL, completed_at TEXT,
  endpoint TEXT NOT NULL, http_status INTEGER, quote_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL, error_message TEXT
);
CREATE TABLE IF NOT EXISTS market_quote_history (
  id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL,
  price REAL NOT NULL, units24h REAL NOT NULL, quote_as_of TEXT NOT NULL,
  fetched_at TEXT NOT NULL, source_url TEXT NOT NULL,
  UNIQUE(symbol, quote_as_of)
);
CREATE TABLE IF NOT EXISTS market_item_quotes (
  symbol TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL,
  day_change_percent REAL, quote_as_of TEXT NOT NULL, fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_item_quote_history (
  id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, price REAL NOT NULL,
  quote_as_of TEXT NOT NULL, fetched_at TEXT NOT NULL,
  UNIQUE(symbol, quote_as_of)
);
CREATE TABLE IF NOT EXISTS market_item_sync_log (
  id INTEGER PRIMARY KEY, attempted_at TEXT NOT NULL, completed_at TEXT,
  endpoint TEXT NOT NULL, quote_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL, error_message TEXT
);
CREATE TABLE IF NOT EXISTS market_item_order_books (
  symbol TEXT PRIMARY KEY, best_bid REAL, best_bid_quantity REAL,
  best_ask REAL, best_ask_quantity REAL, suggested_sell_offer REAL,
  fetched_at TEXT NOT NULL, source_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_item_order_book_history (
  id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, best_bid REAL, best_ask REAL,
  suggested_sell_offer REAL, quote_as_of TEXT NOT NULL, fetched_at TEXT NOT NULL,
  UNIQUE(symbol, quote_as_of)
);
CREATE INDEX IF NOT EXISTS idx_market_item_quote_history_symbol_date
  ON market_item_quote_history(symbol, quote_as_of DESC);
CREATE INDEX IF NOT EXISTS idx_market_item_order_book_history_symbol_date
  ON market_item_order_book_history(symbol, quote_as_of DESC);
CREATE INDEX IF NOT EXISTS idx_market_quote_history_symbol_date
  ON market_quote_history(symbol, quote_as_of DESC);
INSERT OR IGNORE INTO market_quote_history
  (symbol, name, price, units24h, quote_as_of, fetched_at, source_url)
SELECT symbol, name, price, units24h, quote_as_of, fetched_at, source_url FROM market_quotes;
CREATE INDEX IF NOT EXISTS idx_recipes_product ON recipes(product_item_id);
CREATE INDEX IF NOT EXISTS idx_recipes_station ON recipes(station_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_item ON recipe_ingredients(item_id);
CREATE INDEX IF NOT EXISTS idx_changelog_date ON changelog_entries(published_date DESC);
