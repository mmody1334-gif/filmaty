import type { Env } from "../env.ts";
import { attachEnTitles } from "./en-titles.ts";
import { TMDB_BASE, tmdbApiKey } from "./search.ts";

export type EgyptTop10PlatformKey = "netflix" | "shahid" | "yango" | "watchit";

export interface EgyptTop10Payload {
  region: "EG";
  date: string;
  updatedAt: string;
  platforms: Record<EgyptTop10PlatformKey, any[]>;
}

interface DiscoverSource {
  type: "movie" | "tv";
  query: string;
}

const TOP10_CACHE_TTL = 26 * 3600; // 26 hours, refreshed daily per Cairo midnight

/** Current calendar date in Cairo timezone (UTC+2) formatted as YYYY-MM-DD. */
export function cairoDateKey(now = new Date()): string {
  return new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

export function top10CacheKey(date: string): string {
  return `top10eg:v1:${date}`;
}

async function fetchDiscoverList(
  env: Env,
  type: "movie" | "tv",
  queryParams: string,
  language: string,
): Promise<any[]> {
  const url = `${TMDB_BASE}/discover/${type}?api_key=${tmdbApiKey(env)}&language=${language}&include_adult=false&${queryParams}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: any[] };
    return (data.results || []).map((item) => ({ ...item, media_type: type }));
  } catch {
    return [];
  }
}

async function fetchSourceWithEnTitles(env: Env, src: DiscoverSource): Promise<any[]> {
  const [arItems, enItems] = await Promise.all([
    fetchDiscoverList(env, src.type, src.query, "ar"),
    fetchDiscoverList(env, src.type, src.query, "en-US").catch(() => []),
  ]);
  return attachEnTitles(arItems, enItems, src.type);
}

function dedupeAndSortByPopularity(items: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of items) {
    if (!item || !item.id || !item.poster_path) continue;
    const type = item.media_type === "tv" ? "tv" : "movie";
    const key = `${type}:${item.id}`;
    if (!map.has(key)) {
      map.set(key, { ...item, media_type: type });
    }
  }
  return [...map.values()].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

async function buildPlatformTop10(
  env: Env,
  sources: DiscoverSource[],
  padSource?: DiscoverSource,
): Promise<any[]> {
  const primaryLists = await Promise.all(sources.map((s) => fetchSourceWithEnTitles(env, s)));
  let ranked = dedupeAndSortByPopularity(primaryLists.flat());

  if (ranked.length < 10 && padSource) {
    const padItems = dedupeAndSortByPopularity(await fetchSourceWithEnTitles(env, padSource));
    const seen = new Set(ranked.map((i) => `${i.media_type}:${i.id}`));
    for (const item of padItems) {
      if (ranked.length >= 10) break;
      const key = `${item.media_type}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranked.push(item);
      }
    }
  }

  return ranked.slice(0, 10).map((item, idx) => ({ ...item, rank: idx + 1 }));
}

export async function getEgyptTop10(env: Env, now = new Date()): Promise<EgyptTop10Payload> {
  const date = cairoDateKey(now);
  const key = top10CacheKey(date);

  try {
    const cached = await env.CACHE?.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as EgyptTop10Payload;
      if (parsed && parsed.date === date && parsed.platforms) {
        return parsed;
      }
    }
  } catch {
    /* ignore KV read errors */
  }

  const daysAgo = (d: number) => cairoDateKey(new Date(now.getTime() - d * 86_400_000));
  const today = date;

  const [netflix, shahid, yango, watchit] = await Promise.all([
    buildPlatformTop10(env, [
      {
        type: "movie",
        query: `watch_region=EG&with_watch_providers=8&primary_release_date.gte=${daysAgo(365)}&primary_release_date.lte=${today}&sort_by=popularity.desc`,
      },
      {
        type: "tv",
        query: `watch_region=EG&with_watch_providers=8&air_date.gte=${daysAgo(120)}&air_date.lte=${today}&first_air_date.gte=${daysAgo(730)}&without_genres=10767,10763,10764&sort_by=popularity.desc`,
      },
      {
        type: "tv",
        query: `with_networks=213&air_date.gte=${daysAgo(90)}&air_date.lte=${today}&first_air_date.gte=${daysAgo(730)}&without_genres=10767,10763,10764&sort_by=popularity.desc`,
      },
    ]),
    buildPlatformTop10(env, [
      {
        type: "tv",
        query: `with_networks=3626&first_air_date.gte=${daysAgo(540)}&first_air_date.lte=${today}&sort_by=popularity.desc`,
      },
      {
        type: "tv",
        query: `watch_region=EG&with_watch_providers=1715&with_original_language=ar&first_air_date.gte=${daysAgo(730)}&sort_by=popularity.desc`,
      },
      {
        type: "movie",
        query: `watch_region=EG&with_watch_providers=1715&primary_release_date.gte=${daysAgo(730)}&primary_release_date.lte=${today}&sort_by=popularity.desc`,
      },
    ]),
    buildPlatformTop10(
      env,
      [
        {
          type: "tv",
          query: `with_networks=7736&first_air_date.lte=${today}&sort_by=popularity.desc`,
        },
        {
          type: "movie",
          query: `with_companies=260351&primary_release_date.lte=${today}&sort_by=popularity.desc`,
        },
      ],
      {
        type: "movie",
        query: `with_original_language=ar&with_origin_country=EG&primary_release_date.gte=${daysAgo(365)}&primary_release_date.lte=${today}&sort_by=popularity.desc`,
      },
    ),
    buildPlatformTop10(env, [
      {
        type: "tv",
        query: `with_networks=4786&first_air_date.gte=${daysAgo(730)}&first_air_date.lte=${today}&sort_by=popularity.desc`,
      },
      {
        type: "movie",
        query: `with_companies=137350|136598|127387|258445&primary_release_date.gte=${daysAgo(730)}&primary_release_date.lte=${today}&sort_by=popularity.desc`,
      },
    ]),
  ]);

  const payload: EgyptTop10Payload = {
    region: "EG",
    date,
    updatedAt: now.toISOString(),
    platforms: { netflix, shahid, yango, watchit },
  };

  if (netflix.length || shahid.length || yango.length || watchit.length) {
    try {
      await env.CACHE?.put(key, JSON.stringify(payload), { expirationTtl: TOP10_CACHE_TTL });
    } catch {
      /* ignore KV write errors */
    }
  }

  return payload;
}
