import type { Env } from "../env.ts";
import { parseList } from "../env.ts";
import { normalizeArabic, parseSeasonEpisode } from "./normalize.ts";
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

const RESOLVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// A resolved direct URL is only usable if the host actually serves video:
// a cheap Range probe (first byte only) must answer 200/206 and must not
// be an error page (HTML/JSON/plain-text). A dead CDN host answers 526 or
// throws — both mean "not usable", never a playable link.
export async function validateDirectUrl(url: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0", "User-Agent": RESOLVER_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return false;
  }
  try {
    if (res.status !== 200 && res.status !== 206) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (
      ct.includes("text/html") ||
      ct.includes("application/json") ||
      ct.includes("text/plain")
    ) {
      return false;
    }
    return true;
  } finally {
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
  }
}

// -----------------------------------------------------------------------------
// Strict title matching
// -----------------------------------------------------------------------------
// Provider search results are loose: Akwam returns "Dexter: Resurrection"
// for a "Dexter" query, and taking results[0] then resolved the WRONG show
// (dexter.resurrection.s02e01.mp4 for a Dexter S1E1 request). Normalise both
// sides (lowercase, strip parenthesised bits, years and punctuation) and
// only accept an exact match — or the requested title followed by nothing
// but season/episode metadata ("Dexter Season 2"). A subtitle after the
// title ("Resurrection", "New Blood") is a different show and is rejected.
//
// Season metadata must be stripped BEFORE comparing, in both forms
// providers actually use: digits ("الموسم 1", "Season 2") AND Arabic
// ordinal words ("الموسم الاول", "الموسم الثاني"). Akwam titles carry
// both at once — "Dexter الموسم الاول (الموسم 1)" — so the strip runs
// globally. Without the word form, the real Dexter S1 candidate was
// rejected and the resolver returned null live (2026-11-16).
const SEASON_WORD =
  "(?:الموسم|موسم|جزء|season|series|part)\\s+(?:\\d{1,2}|الحادي عشر|الثاني عشر|الاولي|الثانيه|الثالثه|الرابعه|الخامسه|السادسه|السابعه|الثامنه|التاسعه|العاشره|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)";

export function normalizeTitleForMatch(raw: string): string {
  return normalizeArabic(raw)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\bs\d{1,2}\s*e\d{1,3}\b/gi, " ")
    .replace(new RegExp(SEASON_WORD, "g"), " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

const SEASON_ONLY_SUFFIX =
  /^(season|series|part|الموسم|موسم|جزء)\s*\d+$/i;

export function titlesMatch(candidateTitle: string, requestedTitle: string): boolean {
  const cand = normalizeTitleForMatch(candidateTitle);
  const req = normalizeTitleForMatch(requestedTitle);
  if (!cand || !req) return false;
  if (cand === req) return true;
  if (cand.startsWith(req + " ")) {
    const rest = cand.slice(req.length).trim();
    // Only season/episode metadata may follow the title.
    return SEASON_ONLY_SUFFIX.test(rest);
  }
  return false;
}

export async function resolveBestDirectStream(
  provider: Provider,
  targetUrl: string,
  title: string,
  kind: MediaKind,
  seasonNum?: number,
  episodeNum?: number,
): Promise<ResolvedStream> {
  // 1. Try provider's own resolver (only a validated direct URL counts).
  if (provider.resolveStream) {
    try {
      const stream = await provider.resolveStream(targetUrl);
      if (
        stream &&
        isDirectMediaUrl(stream.directVideoUrl) &&
        (await validateDirectUrl(stream.directVideoUrl))
      ) {
        return stream;
      }
    } catch {
      /* continue to lookup */
    }
  }

  // 2. Direct lookup on Akwam to obtain real direct .mp4 CDN URL.
  // Only candidates whose title strictly matches the requested title are
  // considered, and for series the matched show must actually contain the
  // requested season/episode — no falling back to season/episode [0].
  try {
    const akwam = new AkwamProvider();
    const cleanQ = title.replace(/\([^)]*\)/g, "").trim();
    const results = await akwam.search(cleanQ, kind);
    const matched = results.filter((c) => titlesMatch(c.title, cleanQ));
    for (const cand of matched) {
      const details = await akwam.getDetails(cand);
      try {
        if (kind === "movie" && details.sources.length > 0) {
          for (const src of details.sources) {
            const stream = await akwam.resolveStream(src.url);
            if (
              stream &&
              isDirectMediaUrl(stream.directVideoUrl) &&
              (await validateDirectUrl(stream.directVideoUrl))
            ) {
              return stream;
            }
          }
        }
        if (kind === "series" && details.seasons.length > 0) {
          const s = details.seasons.find((sg) => sg.season === (seasonNum || 1));
          if (!s) continue;
          const ep = s.episodes.find((e) => e.episode === (episodeNum || 1));
          if (!ep) continue;
          const epSources = await akwam.getEpisodeSources(ep);
          for (const src of epSources) {
            const stream = await akwam.resolveStream(src.url);
            if (
              stream &&
              isDirectMediaUrl(stream.directVideoUrl) &&
              (await validateDirectUrl(stream.directVideoUrl))
            ) {
              return stream;
            }
          }
        }
      } catch {
        /* this candidate failed: try the next matched one */
        continue;
      }
    }
  } catch {
    /* ignore and continue */
  }

  // 3. Final fallback: one more attempt at the provider's own resolver
  // (a transient failure on the first try can succeed on retry), or —
  // when the provider cannot resolve at all (e.g. the embed provider) —
  // scrape a direct mp4 out of the target page itself. Only a validated
  // URL is returned; otherwise fail loudly instead of handing callers a
  // dead link. Callers handle the throw: the bot shows "تعذر استخراج
  // الرابط المباشر" and /api/resolve tries the next candidate (or returns
  // { ok: false } so the frontend falls back).
  if (provider.resolveStream) {
    try {
      const stream = await provider.resolveStream(targetUrl);
      if (
        stream &&
        isDirectMediaUrl(stream.directVideoUrl) &&
        (await validateDirectUrl(stream.directVideoUrl))
      ) {
        return stream;
      }
    } catch {
      /* fall through to the throw */
    }
  } else {
    try {
      const stream = await new AkwamProvider().resolveStream(targetUrl);
      if (
        stream &&
        isDirectMediaUrl(stream.directVideoUrl) &&
        (await validateDirectUrl(stream.directVideoUrl))
      ) {
        return stream;
      }
    } catch {
      /* fall through to the throw */
    }
  }
  throw new Error(
    "تعذر التحقق من رابط الفيديو المباشر — قد يكون المصدر غير متاح حالياً.",
  );
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
  // Strict title filter: provider search is loose (isRelevant accepts a
  // substring), so a spin-off such as "Dexter: Resurrection" can outrank
  // the real "Dexter" and resolve to the wrong show/episode. Drop every
  // candidate whose title does not strictly match the requested title.
  candidates = candidates.filter((c) => titlesMatch(c.title, enTitle.originalTitle));

  // Arabic fallback if the English title matched nothing.
  if (candidates.length === 0) {
    const arData = await fetchTmdbDetails(env, type, tmdbId, "ar");
    const arTitle = tmdbTitleOf(arData, type);
    if (arTitle && arTitle.originalTitle !== enTitle.originalTitle) {
      const arCandidates = await searchAllProviders(arTitle.originalTitle, kind, disabled);
      candidates = arCandidates.filter((c) =>
        titlesMatch(c.title, arTitle.originalTitle),
      );
    }
  }

  for (const candidate of candidates) {
    // Series: a candidate page is one season's page (Akwam titles carry
    // it — "Dexter (الموسم 2)"), and a video page can be one episode's
    // page ("...الحلقة 4"). Never resolve a request for season N /
    // episode M from a page that declares a different season or episode:
    // Akwam's details parser used to label every page's episodes as
    // season 1, and Laroza used to default any bare title to episode 1,
    // so without this filter a season-2 page or an episode-4 page listed
    // first would hand back the wrong episode.
    if (type === "tv") {
      const declared = parseSeasonEpisode(candidate.title);
      if (
        season !== undefined &&
        declared.season !== undefined &&
        declared.season !== season
      ) {
        continue;
      }
      if (
        episode !== undefined &&
        declared.episode !== undefined &&
        declared.episode !== episode
      ) {
        continue;
      }
    }
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
  // Series: the matched show must actually contain the requested
  // season/episode — never fall back to season/episode [0], which would
  // hand the user a different episode, and never fall back to the
  // page's first source when no season structure exists at all: a
  // bare-title video page can be any episode (Laroza once returned an
  // episode-4 file for an episode-1 request this way). If the episode
  // cannot be verified, return null so the caller tries the next
  // candidate (or falls back to vidlink).
  if (details.seasons.length > 0) {
    const seasonGroup = details.seasons.find((sg) => sg.season === (season || 1));
    if (!seasonGroup) return null;
    const ep = seasonGroup.episodes.find((e) => e.episode === (episode || 1));
    if (!ep) return null;
    try {
      const epSources = await provider.getEpisodeSources(ep);
      if (epSources.length > 0) return epSources[0].url;
    } catch {
      /* fall through to the episode page itself */
    }
    return ep.url;
  }
  return null;
}
