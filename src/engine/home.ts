// Home data for /api/home + view counting for /api/view.
//
// Views are counted per title (no per-user tracking, no auth): a KV
// counter views:<type>:<id> plus a cached top list views:top (top 20 by
// count, recomputed on each view; last-write-wins, race-tolerant).
// Home returns { mostWatched, topRated }; mostWatched falls back to TMDB
// trending when nothing has been watched yet, so home is never empty.
// The home response is cached in KV for 10 minutes.

import type { Env } from "../env.ts";
import { fetchTmdbDetails } from "./resolve.ts";
import { attachEnTitles, enTitleFromTranslations } from "./en-titles.ts";
import { TMDB_BASE, tmdbApiKey } from "./search.ts";

export interface TopViewEntry {
  type: "movie" | "tv";
  id: number;
  count: number;
}

const TOP_VIEWS_KEY = "views:top";
const HOME_CACHE_KEY = "home:cache2";
const HOME_CACHE_TTL = 10 * 60; // 10 minutes
const TOP_N = 20;

export function viewCounterKey(type: "movie" | "tv", id: number): string {
  return `views:${type}:${id}`;
}

export async function recordView(
  env: Env,
  type: "movie" | "tv",
  id: number,
): Promise<{ count: number; top: TopViewEntry[] }> {
  let count = 0;
  try {
    const raw = await env.CACHE?.get(viewCounterKey(type, id));
    count = (raw ? Number.parseInt(raw, 10) || 0 : 0) + 1;
    await env.CACHE?.put(viewCounterKey(type, id), String(count));
  } catch {
    /* KV unavailable: count stays 0, top list unchanged below */
  }

  let top: TopViewEntry[] = [];
  try {
    const rawTop = await env.CACHE?.get(TOP_VIEWS_KEY);
    top = rawTop ? (JSON.parse(rawTop) as TopViewEntry[]) : [];
  } catch {
    top = [];
  }
  if (count > 0) {
    const existing = top.find((e) => e.type === type && e.id === id);
    if (existing) existing.count = count;
    else top.push({ type, id, count });
    top.sort((a, b) => b.count - a.count);
    top = top.slice(0, TOP_N);
    try {
      await env.CACHE?.put(TOP_VIEWS_KEY, JSON.stringify(top));
    } catch {
      /* ignore */
    }
  }
  return { count, top };
}

export interface HomeData {
  mostWatched: any[];
  topRated: any[];
}

export async function getHome(env: Env): Promise<HomeData> {
  try {
    const cached = await env.CACHE?.get(HOME_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as HomeData;
      if (parsed && Array.isArray(parsed.mostWatched) && Array.isArray(parsed.topRated)) {
        return parsed;
      }
    }
  } catch {
    /* fall through to a live build */
  }

  const data = await buildHome(env);
  try {
    await env.CACHE?.put(HOME_CACHE_KEY, JSON.stringify(data), {
      expirationTtl: HOME_CACHE_TTL,
    });
  } catch {
    /* ignore */
  }
  return data;
}

async function buildHome(env: Env): Promise<HomeData> {
  const [mostWatched, topRated] = await Promise.all([
    mostWatchedFromViews(env),
    topRatedFromTmdb(env),
  ]);
  return { mostWatched, topRated };
}

async function mostWatchedFromViews(env: Env): Promise<any[]> {
  let top: TopViewEntry[] = [];
  try {
    const raw = await env.CACHE?.get(TOP_VIEWS_KEY);
    top = raw ? (JSON.parse(raw) as TopViewEntry[]) : [];
  } catch {
    top = [];
  }
  const items: any[] = [];
  for (const entry of top.slice(0, TOP_N)) {
    const details =
      (await fetchTmdbDetails(env, entry.type, entry.id, "ar", "translations")) ||
      (await fetchTmdbDetails(env, entry.type, entry.id, "en-US"));
    if (details) {
      const { translations, ...rest } = details;
      items.push({ ...rest, media_type: entry.type, title_en: enTitleFromTranslations(details) });
    }
  }
  if (items.length > 0) return items;
  // Never empty: fall back to TMDB trending.
  return trendingFallback(env);
}

async function trendingFallback(env: Env): Promise<any[]> {
  try {
    const url = (lang: string) =>
      `${TMDB_BASE}/trending/all/day?api_key=${encodeURIComponent(tmdbApiKey(env))}&language=${lang}`;
    const [res, enRes] = await Promise.all([
      fetch(url("ar"), { signal: AbortSignal.timeout(10000) }),
      fetch(url("en-US"), { signal: AbortSignal.timeout(10000) }).catch(() => null),
    ]);
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as any;
    const enData = enRes && enRes.ok ? ((await enRes.json().catch(() => null)) as any) : null;
    const list = (data?.results || [])
      .filter((i: any) => i.media_type === "movie" || i.media_type === "tv")
      .slice(0, TOP_N);
    return attachEnTitles(list, enData?.results || []);
  } catch {
    return [];
  }
}

async function topRatedFromTmdb(env: Env): Promise<any[]> {
  const fetchList = async (type: "movie" | "tv"): Promise<any[]> => {
    try {
      const url = (lang: string) =>
        `${TMDB_BASE}/${type}/top_rated?api_key=${encodeURIComponent(tmdbApiKey(env))}&language=${lang}`;
      const [res, enRes] = await Promise.all([
        fetch(url("ar"), { signal: AbortSignal.timeout(10000) }),
        fetch(url("en-US"), { signal: AbortSignal.timeout(10000) }).catch(() => null),
      ]);
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as any;
      const enData = enRes && enRes.ok ? ((await enRes.json().catch(() => null)) as any) : null;
      const list = (data?.results || []).map((r: any) => ({ ...r, media_type: type }));
      return attachEnTitles(list, enData?.results || [], type);
    } catch {
      return [];
    }
  };
  const [movies, tv] = await Promise.all([fetchList("movie"), fetchList("tv")]);
  return [...movies, ...tv]
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
    .slice(0, TOP_N);
}
