import type { Env } from "../env.ts";
import { parseList } from "../env.ts";
import { AkwamProvider } from "../providers/akwam.ts";
import { findProvider, searchAllProviders } from "../providers/index.ts";
import type { MediaKind, Provider, ResolvedStream } from "../providers/types.ts";

const TMDB_BASE = "https://api.themoviedb.org/3";

export function isDirectMediaUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.includes("downet.net") ||
    url.includes("okprimeone.site") ||
    /\.(mp4|mkv|webm|avi)(\?|$)/i.test(url)
  );
}

export async function resolveBestDirectStream(
  provider: Provider,
  targetUrl: string,
  title: string,
  kind: MediaKind,
  seasonNum?: number,
  episodeNum?: number,
): Promise<ResolvedStream> {
  // 1. Try provider's own resolver
  if (provider.resolveStream) {
    try {
      const stream = await provider.resolveStream(targetUrl);
      if (stream && isDirectMediaUrl(stream.directVideoUrl)) {
        return stream;
      }
    } catch {
      /* continue to lookup */
    }
  }

  // 2. Direct lookup on Akwam to obtain real direct .mp4 CDN URL
  try {
    const akwam = new AkwamProvider();
    const cleanQ = title.replace(/\([^)]*\)/g, "").trim();
    const results = await akwam.search(cleanQ, kind);
    if (results.length > 0) {
      const cand = results[0];
      const details = await akwam.getDetails(cand);
      if (kind === "movie" && details.sources.length > 0) {
        return await akwam.resolveStream(details.sources[0].url);
      }
      if (kind === "series" && details.seasons.length > 0) {
        const s =
          details.seasons.find((sg) => sg.season === (seasonNum || 1)) ||
          details.seasons[0];
        const ep =
          s.episodes.find((e) => e.episode === (episodeNum || 1)) ||
          s.episodes[0];
        if (ep) {
          const epSources = await akwam.getEpisodeSources(ep);
          if (epSources.length > 0) {
            return await akwam.resolveStream(epSources[0].url);
          }
        }
      }
    }
  } catch {
    /* ignore and continue */
  }

  // 3. Final fallback
  if (provider.resolveStream) {
    return await provider.resolveStream(targetUrl);
  }
  return await new AkwamProvider().resolveStream(targetUrl);
}

// -----------------------------------------------------------------------------
// TMDB helpers
// -----------------------------------------------------------------------------

export interface TmdbTitle {
  /** Display title (title / name). */
  title: string;
  /** Original-language title, best for matching against providers. */
  originalTitle: string;
  year?: number;
}

export async function fetchTmdbDetails(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
  language: string,
): Promise<any | null> {
  const key = env.TMDB_KEY;
  if (!key) return null;
  const path = type === "tv" ? "tv" : "movie";
  try {
    const res = await fetch(
      `${TMDB_BASE}/${path}/${tmdbId}?api_key=${key}&language=${language}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    return (await res.json()) as any;
  } catch {
    return null;
  }
}

export function tmdbTitleOf(data: any, type: "movie" | "tv"): TmdbTitle | null {
  if (!data) return null;
  const title =
    type === "tv" ? data.name || data.original_name : data.title || data.original_title;
  const originalTitle =
    type === "tv" ? data.original_name || data.name : data.original_title || data.title;
  if (!title && !originalTitle) return null;
  const date = data.release_date || data.first_air_date || "";
  const year = date ? Number(String(date).slice(0, 4)) || undefined : undefined;
  return { title: title || originalTitle, originalTitle: originalTitle || title, year };
}

// -----------------------------------------------------------------------------
// resolveByTmdb: TMDB id -> direct mp4 stream (shared by /api/resolve and bot)
// -----------------------------------------------------------------------------

export interface ResolvedDirect {
  directVideoUrl: string;
  title: string;
  quality?: string;
}

const CACHE_SUCCESS_TTL = 6 * 3600; // 6 hours
const CACHE_FAILURE_TTL = 30 * 60; // 30 minutes

export async function resolveByTmdb(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<ResolvedDirect | null> {
  const cacheKey = `dl:${type}:${tmdbId}:${season || 0}:${episode || 0}`;

  try {
    const cached = await env.CACHE?.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { ok: boolean } & ResolvedDirect;
      if (parsed && parsed.ok) {
        return {
          directVideoUrl: parsed.directVideoUrl,
          title: parsed.title,
          quality: parsed.quality,
        };
      }
      if (parsed && parsed.ok === false) return null;
    }
  } catch {
    /* cache read failure: fall through to live resolve */
  }

  const result = await resolveByTmdbUncached(env, type, tmdbId, season, episode);

  try {
    if (result) {
      await env.CACHE?.put(
        cacheKey,
        JSON.stringify({ ok: true, ...result }),
        { expirationTtl: CACHE_SUCCESS_TTL },
      );
    } else {
      await env.CACHE?.put(cacheKey, JSON.stringify({ ok: false }), {
        expirationTtl: CACHE_FAILURE_TTL,
      });
    }
  } catch {
    /* cache write failure: ignore */
  }

  return result;
}

async function resolveByTmdbUncached(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<ResolvedDirect | null> {
  const kind: MediaKind = type === "tv" ? "series" : "movie";
  const disabled = parseList(env.PROVIDERS_DISABLED);

  // English title first: providers match English titles more reliably.
  const enData = await fetchTmdbDetails(env, type, tmdbId, "en-US");
  const enTitle = tmdbTitleOf(enData, type);
  if (!enTitle) return null;

  let candidates = await searchAllProviders(enTitle.originalTitle, kind, disabled);

  // Arabic fallback if the English title matched nothing.
  if (candidates.length === 0) {
    const arData = await fetchTmdbDetails(env, type, tmdbId, "ar");
    const arTitle = tmdbTitleOf(arData, type);
    if (arTitle && arTitle.originalTitle !== enTitle.originalTitle) {
      candidates = await searchAllProviders(arTitle.originalTitle, kind, disabled);
    }
  }

  for (const candidate of candidates) {
    const provider = findProvider(candidate.site);
    if (!provider) continue;
    try {
      const details = await provider.getDetails(candidate);
      const targetUrl = await pickTargetUrl(provider, details, type, season, episode, candidate.url);
      if (!targetUrl) continue;
      const stream = await resolveBestDirectStream(
        provider,
        targetUrl,
        enTitle.originalTitle,
        kind,
        season,
        episode,
      );
      if (stream && isDirectMediaUrl(stream.directVideoUrl)) {
        return {
          directVideoUrl: stream.directVideoUrl,
          title: enTitle.title,
          quality: stream.quality,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function pickTargetUrl(
  provider: Provider,
  details: import("../providers/types.ts").MediaDetails,
  type: "movie" | "tv",
  season: number | undefined,
  episode: number | undefined,
  fallbackUrl: string,
): Promise<string | null> {
  if (type === "movie") {
    return details.sources[0]?.url || fallbackUrl;
  }
  // Series: find the requested season/episode, then its first source.
  const seasonGroup =
    details.seasons.find((sg) => sg.season === (season || 1)) || details.seasons[0];
  const ep =
    seasonGroup?.episodes.find((e) => e.episode === (episode || 1)) ||
    seasonGroup?.episodes[0];
  if (ep) {
    try {
      const epSources = await provider.getEpisodeSources(ep);
      if (epSources.length > 0) return epSources[0].url;
    } catch {
      /* fall through to details sources */
    }
    return ep.url;
  }
  return details.sources[0]?.url || fallbackUrl;
}
