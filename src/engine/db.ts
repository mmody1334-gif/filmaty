import type { Env } from "../env.ts";

export interface D1TopViewRow {
  type: "movie" | "tv";
  id: number;
  count: number;
  updatedAt: number;
}

export interface ArchivedStreamSnapshot {
  type: "movie" | "tv";
  id: number;
  s?: number;
  e?: number;
  title: string;
  servers: Array<{ name: string; qualities: Array<{ quality?: string }> }>;
}

const initializedDbs = new WeakSet<object>();

/** Ensure `title_views` and `resolved_streams` tables exist on real D1 bindings. */
export async function ensureAnalyticsTables(env: Env): Promise<D1Database | null> {
  const db = (env as { DB?: D1Database }).DB;
  if (!db || typeof db.prepare !== "function") return null;
  if (initializedDbs.has(db)) return db;
  try {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS title_views (key TEXT PRIMARY KEY, media_type TEXT NOT NULL, tmdb_id INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)",
      )
      .run();
    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_title_views_hot ON title_views (views DESC, updated_at DESC)",
      )
      .run();
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS resolved_streams (cache_key TEXT PRIMARY KEY, media_type TEXT NOT NULL, tmdb_id INTEGER NOT NULL, season INTEGER NOT NULL DEFAULT 0, episode INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, payload_json TEXT NOT NULL, resolved_at INTEGER NOT NULL)",
      )
      .run();
    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_resolved_streams_title ON resolved_streams (media_type, tmdb_id, resolved_at DESC)",
      )
      .run();
    initializedDbs.add(db);
    return db;
  } catch {
    return null;
  }
}

/**
 * Atomically increment a title's view counter in D1 so concurrent clicks
 * never race or lose updates (returns null if D1 is absent or fails).
 */
export async function recordViewD1(
  env: Env,
  type: "movie" | "tv",
  id: number,
  now = Date.now(),
): Promise<number | null> {
  const db = await ensureAnalyticsTables(env);
  if (!db) return null;
  const key = `${type}:${id}`;
  try {
    await db
      .prepare(
        "INSERT INTO title_views (key, media_type, tmdb_id, views, updated_at) VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT(key) DO UPDATE SET views = views + 1, updated_at = ?4",
      )
      .bind(key, type, id, now)
      .run();
    const stmt = db.prepare("SELECT views FROM title_views WHERE key = ?1").bind(key);
    if (typeof stmt.first !== "function") return 1;
    const row = (await stmt.first()) as { views?: number } | null;
    const views = Number(row?.views);
    return Number.isFinite(views) && views > 0 ? views : 1;
  } catch {
    return null;
  }
}

/** Fetch top viewed titles ordered by view count descending from D1. */
export async function topViewedFromD1(
  env: Env,
  limit = 20,
): Promise<D1TopViewRow[] | null> {
  const db = await ensureAnalyticsTables(env);
  if (!db) return null;
  try {
    const stmt = db
      .prepare(
        "SELECT media_type, tmdb_id, views, updated_at FROM title_views ORDER BY views DESC, updated_at DESC LIMIT ?1",
      )
      .bind(Math.max(1, Math.min(limit, 50)));
    if (typeof stmt.all !== "function") return null;
    const res = await stmt.all();
    const raw = Array.isArray(res?.results) ? res.results : [];
    const rows: D1TopViewRow[] = [];
    for (const r of raw as Array<Record<string, unknown>>) {
      const mt = r.media_type === "tv" ? "tv" : r.media_type === "movie" ? "movie" : null;
      const tid = Number(r.tmdb_id);
      const views = Number(r.views);
      if (!mt || !Number.isInteger(tid) || tid <= 0) continue;
      rows.push({
        type: mt,
        id: tid,
        count: Number.isFinite(views) && views > 0 ? views : 1,
        updatedAt: Number(r.updated_at) || 0,
      });
    }
    return rows;
  } catch {
    return null;
  }
}

/**
 * Archive redacted resolved server metadata (server names & quality tiers,
 * never short-lived stream tokens) in D1 for diagnostics and warm analytics.
 */
export async function archiveResolvedStreamD1(
  env: Env,
  snapshot: ArchivedStreamSnapshot,
  now = Date.now(),
): Promise<boolean> {
  const db = await ensureAnalyticsTables(env);
  if (!db) return false;
  const s = snapshot.type === "tv" ? Math.max(0, Math.floor(snapshot.s || 1)) : 0;
  const e = snapshot.type === "tv" ? Math.max(0, Math.floor(snapshot.e || 1)) : 0;
  const cacheKey = `${snapshot.type}:${snapshot.id}:${s}:${e}`;
  const redactedPayload = JSON.stringify({
    servers: snapshot.servers.map((srv) => ({
      name: String(srv.name || ""),
      qualities: (srv.qualities || []).map((q) => String(q?.quality || "")).filter(Boolean),
    })),
  });
  try {
    await db
      .prepare(
        "INSERT INTO resolved_streams (cache_key, media_type, tmdb_id, season, episode, title, payload_json, resolved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(cache_key) DO UPDATE SET title = ?6, payload_json = ?7, resolved_at = ?8",
      )
      .bind(
        cacheKey,
        snapshot.type,
        snapshot.id,
        s,
        e,
        String(snapshot.title || "").slice(0, 200),
        redactedPayload,
        now,
      )
      .run();
    return true;
  } catch {
    return false;
  }
}

/** Read an archived resolved-stream snapshot back from D1. */
export async function getArchivedStreamD1(
  env: Env,
  type: "movie" | "tv",
  id: number,
  s = 0,
  e = 0,
): Promise<{ title: string; payload: { servers: Array<{ name: string; qualities: string[] }> }; resolvedAt: number } | null> {
  const db = await ensureAnalyticsTables(env);
  if (!db) return null;
  const season = type === "tv" ? Math.max(0, Math.floor(s || 1)) : 0;
  const episode = type === "tv" ? Math.max(0, Math.floor(e || 1)) : 0;
  const cacheKey = `${type}:${id}:${season}:${episode}`;
  try {
    const stmt = db
      .prepare("SELECT title, payload_json, resolved_at FROM resolved_streams WHERE cache_key = ?1")
      .bind(cacheKey);
    if (typeof stmt.first !== "function") return null;
    const row = (await stmt.first()) as { title?: string; payload_json?: string; resolved_at?: number } | null;
    if (!row || !row.payload_json) return null;
    return {
      title: String(row.title || ""),
      payload: JSON.parse(row.payload_json),
      resolvedAt: Number(row.resolved_at) || 0,
    };
  } catch {
    return null;
  }
}
