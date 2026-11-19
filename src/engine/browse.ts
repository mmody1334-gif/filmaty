// Browsing for /api/browse: TMDB discover behind the Worker (the old
// frontend called TMDB discover directly from the browser, so the
// marvel/netflix tabs were just text searches). Responses are cached in
// KV for 10 minutes, same pattern as /api/home.

import type { Env } from "../env.ts";
import { TMDB_BASE, tmdbApiKey } from "./search.ts";
import { attachEnTitles } from "./en-titles.ts";

export const BROWSE_LANGS = ["ar", "en", "hi", "tr", "ko", "es", "fr", "ja"] as const;
export type BrowseLang = (typeof BROWSE_LANGS)[number];

export const BROWSE_COLLECTIONS = ["marvel", "netflix"] as const;
export type BrowseCollection = (typeof BROWSE_COLLECTIONS)[number];

export interface BrowseParams {
  type: "movie" | "tv";
  // Optional: when omitted the discover is global (no language filter).
  // The tabs and top-rated browse globally; only the drawer language
  // items pass a lang.
  lang?: BrowseLang;
  // Optional 2-letter origin country code (e.g. "US" for American
  // English content) -> TMDB with_origin_country.
  origin?: string;
  sort: "popular" | "top_rated";
  page: number;
  collection?: BrowseCollection;
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
  return `browse3:${p.type}:${scope}:${p.sort}:${p.page}${origin}`;
}

function browseUrl(env: Env, p: BrowseParams, language = "ar"): string {
  const u = new URL(`${TMDB_BASE}/discover/${p.type}`);
  u.searchParams.set("api_key", tmdbApiKey(env));
  u.searchParams.set("language", language);
  u.searchParams.set("include_adult", "false");
  u.searchParams.set("page", String(p.page));
  if (p.collection === "marvel") {
    u.searchParams.set("with_companies", "420");
  } else if (p.collection === "netflix") {
    // Everything streaming on Netflix (originals + licensed), not just
    // Netflix-produced titles: TMDB watch provider 8 in the US catalog,
    // the largest one. (with_companies=11946 returned 0 movies.)
    u.searchParams.set("with_watch_providers", "8");
    u.searchParams.set("watch_region", "US");
  } else if (p.companies) {
    u.searchParams.set("with_companies", p.companies);
  } else if (p.lang) {
    u.searchParams.set("with_original_language", p.lang);
  }
  if (p.origin) {
    u.searchParams.set("with_origin_country", p.origin);
  }
  if (p.sort === "top_rated") {
    u.searchParams.set("sort_by", "vote_average.desc");
    u.searchParams.set("vote_count.gte", "300");
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
