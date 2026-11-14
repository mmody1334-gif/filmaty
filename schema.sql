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
