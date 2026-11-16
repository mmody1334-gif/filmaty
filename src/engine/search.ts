// Unified search for /api/search: TMDB in Arabic + English in parallel
// (the old frontend searched Arabic only, so English queries and Arabic
// transliterations missed), merged and deduped; single-token queries also
// get provider augmentation (TMDB's word index misses compound titles
// like WandaVision for "vision", provider substring search finds them);
// if TMDB returns nothing, fall back to a direct provider search.

import type { Env } from "../env.ts";
import { parseList } from "../env.ts";
import { cleanTitle, normalizeArabicQuery } from "./normalize.ts";
import { searchAllProviders } from "../providers/index.ts";
import type { Candidate } from "../providers/types.ts";
import { titlesMatch } from "./resolve.ts";
import { POPULAR_TITLES } from "../data/popular-titles.ts";

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
  vote_count?: number;
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

// Local bilingual index of famous titles (src/data/popular-titles.ts,
// generated from TMDB trending/popular/top-rated). TMDB's search index
// matches whole words only, so "WandaVision" never comes back for
// q=vision and TMDB ar returns 0 hits for "فيجن" — but a substring
// match here finds it in both scripts ("vision" ⊂ "WandaVision",
// "فيجن" ⊂ "واندافيجن"). Local, no network: run for every query.
// Matches sort by vote_count (accumulated fame), not popularity:
// popularity is a weekly spike — a brand-new show, VisionQuest, sits at
// 308 vs WandaVision's 35, while votes are 499 vs 13,058 — so sorting by
// popularity would put the new show first for "vision".
export function searchPopularIndex(query: string): SearchResultItem[] {
  const q = normalizeArabicQuery(query);
  if (q.length < 2) return [];
  const matches = POPULAR_TITLES.filter(
    (t) =>
      normalizeArabicQuery(t.title_en).includes(q) ||
      normalizeArabicQuery(t.title_ar).includes(q),
  )
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, 5);
  return matches.map((t) => {
    const title = t.title_ar || t.title_en;
    const item: SearchResultItem = {
      id: t.id,
      media_type: t.media_type,
      title,
      original_title: t.title_en,
      release_date: t.release_date,
      first_air_date: t.first_air_date,
      vote_average: t.vote_average,
      vote_count: t.vote_count,
      popularity: t.popularity,
      poster_path: t.poster_path,
    };
    if (t.media_type === "tv") {
      item.name = title;
      item.original_name = t.title_en;
    }
    return item;
  });
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

// Shared provider-candidate processing: attach a TMDB id to every
// candidate whose title exactly matches a TMDB title. The attach is what
// keeps junk out — a candidate that does not match a real TMDB title
// comes back as a provider-only entry (id null + provider link) instead.
// Returns both the attached items and the provider-only entries, in
// pool order, plus the attached-only subset for the augmentation path.
interface AttachedCandidates {
  items: SearchResultItem[];
  attached: SearchResultItem[];
}

async function attachProviderCandidates(
  env: Env,
  pool: Candidate[],
): Promise<AttachedCandidates> {
  const items: SearchResultItem[] = [];
  const attached: SearchResultItem[] = [];
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
      attached.push(match);
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
  return { items, attached };
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
  const { items } = await attachProviderCandidates(env, pool);
  return items;
}

// Provider augmentation for single-token queries: TMDB's search index
// matches whole words only, so a compound title like "WandaVision" can
// never come back for q=vision — but provider site search does substring
// matching (Akwam returns WandaVision for the normalized "فيجن").
// Search the providers with the normalized query, keep candidates whose
// (normalized) title contains the query, and return only the ones that
// attach to a real TMDB title.
async function providerAugment(env: Env, normalizedQuery: string): Promise<SearchResultItem[]> {
  const disabled = parseList(env.PROVIDERS_DISABLED);
  const candidates = await searchAllProviders(normalizedQuery, undefined, disabled);
  const pool = candidates.filter((c) =>
    normalizeArabicQuery(c.title).includes(normalizedQuery),
  );
  const { attached } = await attachProviderCandidates(env, pool);
  return attached;
}

// Re-rank merged TMDB results by match quality, then fame.
// Without this the ar list's order wins outright: q=vision returned
// "Vision On" first and buried WandaVision, because the ar results keep
// their positions ahead of the en ones. Match score per item: exact = 3,
// starts-with = 2, contains = 1, else 0 — best across the title and the
// original title — plus a fame bonus from vote_count, capped at +2.5, so
// a hugely famous contains-match (WandaVision, 13k votes, for q=vision)
// outranks a little-known starts-with match (Vision On) AND an
// exact-titled obscurity (the three films literally called "Vision", a
// few dozen votes each). Any exact match with more than ~500 votes still
// beats every partial match, so real exact titles are safe. The bonus
// uses vote_count, not popularity: popularity is a weekly spike
// (VisionQuest, a brand-new show, sits at 308 vs WandaVision's 35)
// while vote_count is accumulated fame (499 vs 13,058). A zero-match
// item always sorts below every real match, however famous it is.
// Cap at 20.
function rankScore(queryNorm: string, item: SearchResultItem): number {
  const m = matchScore(queryNorm, item);
  const fame = Math.min((item.vote_count || 0) / 1000, 2.5);
  if (m === 0) return -1 + Math.min(fame, 0.5);
  return m + fame;
}
function matchScore(queryNorm: string, item: SearchResultItem): number {
  if (!queryNorm) return 0;
  let best = 0;
  for (const raw of [
    item.title || item.name || "",
    item.original_title || item.original_name || "",
  ]) {
    const t = normalizeArabicQuery(raw);
    if (!t) continue;
    if (t === queryNorm) best = Math.max(best, 3);
    else if (t.startsWith(queryNorm)) best = Math.max(best, 2);
    else if (t.includes(queryNorm)) best = Math.max(best, 1);
  }
  return best;
}

function rerankResults(items: SearchResultItem[], queryNorm: string): SearchResultItem[] {
  return [...items]
    .sort((a, b) => rankScore(queryNorm, b) - rankScore(queryNorm, a))
    .slice(0, 20);
}

export async function searchTitles(env: Env, query: string): Promise<SearchOutcome> {
  // Search TMDB with the normalized query in both languages: "ڤيجن"
  // becomes "فيجن", so TMDB can match "واندافيجن".
  const normalizedQuery = normalizeArabicQuery(query);
  // Single-token queries also get provider augmentation in parallel:
  // TMDB's word index handles multi-word queries, but a lone partial
  // word ("vision", "فيجن") misses compound titles like WandaVision.
  const singleToken = normalizedQuery.length > 0 && !/\s/.test(normalizedQuery);
  const [ar, en, augmented] = await Promise.all([
    tmdbSearch(env, normalizedQuery, "ar"),
    tmdbSearch(env, normalizedQuery, "en-US"),
    singleToken ? providerAugment(env, normalizedQuery) : Promise.resolve([]),
  ]);
  const merged = mergeTmdbResults([ar, en, augmented, searchPopularIndex(query)]);
  if (merged.length > 0) return { results: rerankResults(merged, normalizedQuery), source: "tmdb" };
  const fallback = await providerFallback(env, query);
  return { results: fallback, source: "providers" };
}
