// Unified search for /api/search: TMDB in Arabic + English in parallel
// (the old frontend searched Arabic only, so English queries and Arabic
// transliterations missed), merged and deduped; if TMDB returns nothing,
// fall back to a direct provider search.

import type { Env } from "../env.ts";
import { parseList } from "../env.ts";
import { cleanTitle } from "./normalize.ts";
import { searchAllProviders } from "../providers/index.ts";
import { titlesMatch } from "./resolve.ts";

export const TMDB_BASE = "https://api.themoviedb.org/3";
// Same public TMDB key already embedded in the frontend (index.html) and
// wrangler.toml [vars]; used only when env.TMDB_KEY is unset.
const TMDB_PUBLIC_KEY = "15d2ea6d0dc1d476efbca3eba2b9bbfb";

export function tmdbApiKey(env: Env): string {
  return env.TMDB_KEY || TMDB_PUBLIC_KEY;
}

export interface SearchResultItem {
  id: number | null;
  media_type: "movie" | "tv";
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
  poster_path?: string | null;
  overview?: string;
  // Provider-only entries (no TMDB match): full poster URL + provider link.
  poster?: string;
  provider?: string;
  providerUrl?: string;
}

export interface SearchOutcome {
  results: SearchResultItem[];
  source: "tmdb" | "providers";
}

async function tmdbSearch(env: Env, query: string, language: string): Promise<any[]> {
  const key = tmdbApiKey(env);
  try {
    const res = await fetch(
      `${TMDB_BASE}/search/multi?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&language=${language}&include_adult=false`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as any;
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

// Merge ar + en results, dedupe by media_type:id, keep the entry with the
// most complete data (overview + poster + popularity).
function mergeTmdbResults(lists: any[][]): SearchResultItem[] {
  const byKey = new Map<string, SearchResultItem>();
  const score = (x: any) =>
    (x.overview ? 2 : 0) + (x.poster_path ? 1 : 0) + Math.min((x.popularity || 0) / 100, 1);
  for (const list of lists) {
    for (const item of list) {
      if (item.media_type !== "movie" && item.media_type !== "tv") continue;
      if (!item.id) continue;
      const key = `${item.media_type}:${item.id}`;
      const existing = byKey.get(key);
      if (!existing || score(item) > score(existing)) byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

// Provider fallback: search the providers directly and attach a TMDB id
// when the candidate title matches a TMDB search (bounded: top 5).
// Only candidates that strictly match the query are shown: provider
// search is loose (a substring match), so without this an Arabic query
// TMDB does not know (e.g. "المئة" — TMDB itself returns 0 hits for it)
// came back with junk like "ابو العروسة الجزء الثانى المئة". If nothing
// matches strictly, keep the loose top results rather than returning
// nothing at all.
async function providerFallback(env: Env, query: string): Promise<SearchResultItem[]> {
  const disabled = parseList(env.PROVIDERS_DISABLED);
  const candidates = await searchAllProviders(query, undefined, disabled);
  const cleanQ = cleanTitle(query) || query;
  const strict = candidates.filter(
    (c) => titlesMatch(c.title, cleanQ) || titlesMatch(c.title, query),
  );
  const pool = strict.length > 0 ? strict : candidates;
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();
  for (const c of pool.slice(0, 5)) {
    const hits = await tmdbSearch(env, c.title, "en-US");
    const match = hits.find(
      (h) =>
        (h.media_type === "movie" || h.media_type === "tv") &&
        titlesMatch(h.title || h.name || "", c.title),
    );
    if (match) {
      const key = `${match.media_type}:${match.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(match);
      continue;
    }
    const key = `provider:${c.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: null,
      media_type: c.kind === "series" ? "tv" : "movie",
      title: c.title,
      name: c.title,
      release_date: c.year ? `${c.year}-01-01` : undefined,
      poster: c.poster || undefined,
      provider: c.siteLabel || c.site,
      providerUrl: c.url,
    });
  }
  return items;
}

export async function searchTitles(env: Env, query: string): Promise<SearchOutcome> {
  const [ar, en] = await Promise.all([
    tmdbSearch(env, query, "ar"),
    tmdbSearch(env, query, "en-US"),
  ]);
  const merged = mergeTmdbResults([ar, en]);
  if (merged.length > 0) return { results: merged, source: "tmdb" };
  const fallback = await providerFallback(env, query);
  return { results: fallback, source: "providers" };
}
