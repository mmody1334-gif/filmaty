-- Filmaty Personal Media Archive Schema
CREATE TABLE IF NOT EXISTS archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'movie',
  season INTEGER,
  episode INTEGER,
  quality TEXT,
  host TEXT,
  site TEXT,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_user ON archive (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_title ON archive (title);

-- Atomic view counters (Feature #5)
CREATE TABLE IF NOT EXISTS title_views (
  key TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_title_views_hot ON title_views (views DESC, updated_at DESC);

-- Resolved servers & qualities snapshot archive (Feature #5)
CREATE TABLE IF NOT EXISTS resolved_streams (
  cache_key TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  season INTEGER NOT NULL DEFAULT 0,
  episode INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resolved_streams_title ON resolved_streams (media_type, tmdb_id, resolved_at DESC);
