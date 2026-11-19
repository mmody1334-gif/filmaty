// Browsing for /api/browse: TMDB discover behind the Worker (the old
// frontend called TMDB discover directly from the browser, so the
// marvel/netflix tabs were just text searches). Responses are cached in
// KV for 10 minutes, same pattern as /api/home.

import type { Env } from "../env.ts";
import { TMDB_BASE, tmdbApiKey } from "./search.ts";
import { attachEnTitles } from "./en-titles.ts";

export const BROWSE_LANGS = ["ar", "en", "hi", "tr", "ko", "es", "fr", "ja"] as const;
export type BrowseLang = (typeof BROWSE_LANGS)[number];

export const BROWSE_COLLECTIONS = [
  "marvel",
  "netflix",
  "shahid",
  "watchit",
  "yango",
  "osn",
  "showtime",
  "starzplay",
  "tod",
  "disney",
  "prime",
  "apple",
  "hbo",
  "paramount",
  "hulu",
  "peacock",
  "crunchyroll",
  "dc",
] as const;
export type BrowseCollection = (typeof BROWSE_COLLECTIONS)[number];

const COLLECTION_WATCH_PROVIDERS: Record<string, { id: string; region: string }> = {
  netflix: { id: "8", region: "US" },
  shahid: { id: "1715", region: "EG" },
  osn: { id: "629", region: "EG" },
  starzplay: { id: "630", region: "EG" },
  tod: { id: "1750", region: "EG" },
  disney: { id: "337", region: "US" },
  prime: { id: "9", region: "US" },
  apple: { id: "350", region: "US" },
  hbo: { id: "1899", region: "US" },
  paramount: { id: "531|2303", region: "US" },
  hulu: { id: "15", region: "US" },
  peacock: { id: "386", region: "US" },
  crunchyroll: { id: "283", region: "US" },
};

export const BROWSE_GENRES = [
  "28", "12", "16", "35", "80", "99", "18", "10751", "14", "36",
  "27", "10402", "9648", "10749", "878", "53", "10752", "37",
  "10759", "10765",
] as const;
export type BrowseGenre = (typeof BROWSE_GENRES)[number];

export const BROWSE_SORTS = ["popular", "top_rated", "newest"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];

export interface BrowseParams {
  type: "movie" | "tv";
  // Optional: when omitted the discover is global (no language filter).
  // The tabs and top-rated browse globally; only the drawer language
  // items pass a lang.
  lang?: BrowseLang;
  // Optional 2-letter origin country code (e.g. "US" for American
  // English content) -> TMDB with_origin_country.
  origin?: string;
  sort: BrowseSort;
  page: number;
  collection?: BrowseCollection;
  // Optional TMDB genre id (from BROWSE_GENRES allowlist).
  genre?: BrowseGenre;
  // Optional release year filter (primary_release_year / first_air_date_year).
  year?: number;
  // Optional TMDB company ids (comma-separated) for brand discovery
  // ("429" = DC Comics, "2" = Disney, "3" = Pixar). Used by the search
  // engine's brand layer; mutually exclusive with `collection`.
  companies?: string;
}

export interface BrowseOutcome {
  results: any[];
  total_pages: number;
}

const BROWSE_CACHE_TTL = 10 * 60; // 10 minutes

function browseCacheKey(p: BrowseParams): string {
  const scope = p.collection || p.companies || p.lang || "all";
  const origin = p.origin ? `:origin:${p.origin}` : "";
  const genre = p.genre ? `:g:${p.genre}` : "";
  const year = p.year ? `:y:${p.year}` : "";
  return `browse4:${p.type}:${scope}:${p.sort}:${p.page}${origin}${genre}${year}`;
}

function browseUrl(env: Env, p: BrowseParams, language = "ar"): string {
  const u = new URL(`${TMDB_BASE}/discover/${p.type}`);
  u.searchParams.set("api_key", tmdbApiKey(env));
  u.searchParams.set("language", language);
  u.searchParams.set("include_adult", "false");
  u.searchParams.set("page", String(p.page));
  if (p.collection === "marvel") {
    u.searchParams.set("with_companies", "420");
  } else if (p.collection === "dc") {
    u.searchParams.set("with_companies", "429|9993|128064");
  } else if (p.collection === "watchit") {
    if (p.type === "tv") u.searchParams.set("with_networks", "4786");
    else u.searchParams.set("with_companies", "137350|136598|127387|258445");
  } else if (p.collection === "yango") {
    if (p.type === "tv") {
      u.searchParams.set("with_networks", "7736");
    } else {
      u.searchParams.set("with_original_language", "ar");
      u.searchParams.set("with_origin_country", "EG");
    }
  } else if (p.collection === "showtime") {
    if (p.type === "tv") u.searchParams.set("with_networks", "67");
    else u.searchParams.set("with_companies", "148935|4343");
  } else if (p.collection && COLLECTION_WATCH_PROVIDERS[p.collection]) {
    const wp = COLLECTION_WATCH_PROVIDERS[p.collection];
    u.searchParams.set("with_watch_providers", wp.id);
    u.searchParams.set("watch_region", wp.region);
  } else if (p.companies) {
    u.searchParams.set("with_companies", p.companies);
  } else if (p.lang) {
    u.searchParams.set("with_original_language", p.lang);
  }
  if (p.origin) {
    u.searchParams.set("with_origin_country", p.origin);
  }
  if (p.genre) {
    u.searchParams.set("with_genres", p.genre);
  }
  if (p.year) {
    u.searchParams.set(
      p.type === "tv" ? "first_air_date_year" : "primary_release_year",
      String(p.year),
    );
  }
  if (p.sort === "top_rated") {
    u.searchParams.set("sort_by", "vote_average.desc");
    u.searchParams.set("vote_count.gte", "300");
  } else if (p.sort === "newest") {
    const today = new Date().toISOString().slice(0, 10);
    if (p.type === "tv") {
      u.searchParams.set("sort_by", "first_air_date.desc");
      u.searchParams.set("first_air_date.lte", today);
    } else {
      u.searchParams.set("sort_by", "primary_release_date.desc");
      u.searchParams.set("primary_release_date.lte", today);
    }
    u.searchParams.set("vote_count.gte", "20");
  } else {
    u.searchParams.set("sort_by", "popularity.desc");
  }
  return u.toString();
}

export async function browseTitles(env: Env, p: BrowseParams): Promise<BrowseOutcome> {
  const key = browseCacheKey(p);
  try {
    const cached = await env.CACHE?.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as BrowseOutcome;
      if (parsed && Array.isArray(parsed.results)) return parsed;
    }
  } catch {
    /* fall through to a live fetch */
  }

  let results: any[] = [];
  let totalPages = 0;
  try {
    const [res, enRes] = await Promise.all([
      fetch(browseUrl(env, p), { signal: AbortSignal.timeout(10000) }),
      fetch(browseUrl(env, p, "en-US"), { signal: AbortSignal.timeout(10000) }).catch(() => null),
    ]);
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as any;
      const enData = enRes && enRes.ok ? ((await enRes.json().catch(() => null)) as any) : null;
      results = (data?.results || []).map((r: any) => ({ ...r, media_type: p.type }));
      results = attachEnTitles(results, enData?.results || [], p.type);
      totalPages = Number(data?.total_pages) || 0;
    }
  } catch {
    /* empty result on network failure */
  }

  const outcome: BrowseOutcome = { results, total_pages: totalPages };
  try {
    await env.CACHE?.put(key, JSON.stringify(outcome), {
      expirationTtl: BROWSE_CACHE_TTL,
    });
  } catch {
    /* ignore */
  }
  return outcome;
}
