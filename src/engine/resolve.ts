import type { Env } from "../env.ts";
import { parseList } from "../env.ts";
import { edgeGet, edgePut } from "./edge-cache.ts";
import { normalizeArabic, parseSeasonEpisode } from "./normalize.ts";
import { AkwamProvider } from "../providers/akwam.ts";
import { findProvider, searchAllProviders } from "../providers/index.ts";
import type { Candidate, MediaKind, Provider, ResolvedStream } from "../providers/types.ts";

const TMDB_BASE = "https://api.themoviedb.org/3";

export function isDirectMediaUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.includes("downet.net") ||
    url.includes("okprimeone.site") ||
    /\.(mp4|mkv|webm|avi)(\?|$)/i.test(url)
  );
}

// A direct link is time-bound when its host puts an expiry in the URL:
// Laroza's okprimeone links are signed and expire after 2h (e=7200),
// and Akwam's downet links carry a fixed expiry timestamp in the path
// (/download/<expiry>/<hash>/<file>, ~24h from creation — verified live
// 2026-11-19: two resolves 8 min apart returned the same 1795176189
// timestamp). A cached resolve can therefore hold a link scraped near
// the end of its life, so time-bound links must cache short (see
// SIGNED_LINK_CACHE_TTL below).
export function isTimeBoundDirectUrl(url?: string): boolean {
  if (!url) return false;
  return url.includes("okprimeone.site") || url.includes("downet.net");
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
      signal: AbortSignal.timeout(4500),
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
  const streams = await resolveAllDirectStreams(
    provider,
    targetUrl,
    title,
    kind,
    seasonNum,
    episodeNum,
  );
  if (streams.length > 0) return streams[0];
  throw new Error(
    "تعذر التحقق من رابط الفيديو المباشر — قد يكون المصدر غير متاح حالياً.",
  );
}

// Validate every stream in a list in parallel, keeping usable ones in order.
async function validateStreams(streams: ResolvedStream[]): Promise<ResolvedStream[]> {
  const checks = await Promise.all(
    streams.map(async (s) =>
      s && isDirectMediaUrl(s.directVideoUrl) && (await validateDirectUrl(s.directVideoUrl))
        ? s
        : null,
    ),
  );
  return checks.filter((s): s is ResolvedStream => s !== null);
}

// All validated direct streams for one watch URL: every quality the
// provider offers (Akwam watch pages list 480p/720p/1080p), best first;
// a single stream otherwise. Empty when nothing is usable.
async function tryAllFromWatch(provider: Provider, targetUrl: string): Promise<ResolvedStream[]> {
  try {
    const streams = provider.resolveStreams
      ? await provider.resolveStreams(targetUrl)
      : provider.resolveStream
        ? [await provider.resolveStream(targetUrl)]
        : [];
    return await validateStreams(streams);
  } catch {
    return [];
  }
}

// Same three steps as resolveBestDirectStream, but collecting every
// validated variant instead of stopping at the first one. The first
// stream returned is the same one resolveBestDirectStream returns.
export async function resolveAllDirectStreams(
  provider: Provider,
  targetUrl: string,
  title: string,
  kind: MediaKind,
  seasonNum?: number,
  episodeNum?: number,
  allowAkwamFallback = true,
): Promise<ResolvedStream[]> {
  // 1. Try provider's own resolver (only validated direct URLs count).
  const first = await tryAllFromWatch(provider, targetUrl);
  if (first.length > 0) return first;

  // 2. Direct lookup on Akwam to obtain real direct .mp4 CDN URLs.
  // Only candidates whose title strictly matches the requested title are
  // considered, and for series the matched show must actually contain the
  // requested season/episode — no falling back to season/episode [0].
  if (allowAkwamFallback) {
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
              const found = await tryAllFromWatch(akwam, src.url);
              if (found.length > 0) return found;
            }
          }
          if (kind === "series" && details.seasons.length > 0) {
            const s = details.seasons.find((sg) => sg.season === (seasonNum || 1));
            if (!s) continue;
            const ep = s.episodes.find((e) => e.episode === (episodeNum || 1));
            if (!ep) continue;
            const epSources = await akwam.getEpisodeSources(ep);
            for (const src of epSources) {
              const found = await tryAllFromWatch(akwam, src.url);
              if (found.length > 0) return found;
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
  }

  // 3. Final fallback: scrape a direct mp4 out of an embed page via Akwam
  // (or retry when Akwam fallback is enabled); native providers already
  // tried all watch/download URLs in Step 1 so skip duplicate probes when disabled.
  if (!allowAkwamFallback) {
    return [];
  }
  const retryProvider =
    provider.resolveStreams || provider.resolveStream ? provider : new AkwamProvider();
  return await tryAllFromWatch(retryProvider, targetUrl);
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
  appendToResponse?: string,
): Promise<any | null> {
  const key = env.TMDB_KEY;
  if (!key) return null;
  const path = type === "tv" ? "tv" : "movie";
  try {
    const res = await fetch(
      `${TMDB_BASE}/${path}/${tmdbId}?api_key=${key}&language=${language}${appendToResponse ? `&append_to_response=${appendToResponse}` : ""}`,
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
  // Bumped to dl2: after the stale-cache fix — the dl: entries cached
  // before it can hold a time-bound direct link (Laroza 2h, downet
  // ~24h) for 6h and must not be reused.
  const cacheKey = `dl3:${type}:${tmdbId}:${season || 0}:${episode || 0}`;

  try {
    const cached = await edgeGet(cacheKey, env.CACHE);
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
      await edgePut(
        cacheKey,
        JSON.stringify({ ok: true, ...result }),
        // Same rule as resolveCacheTtl: time-bound provider links
        // cache for 1h only, so a dead link is never served from a
        // 6h-old entry.
        isTimeBoundDirectUrl(result.directVideoUrl)
          ? SIGNED_LINK_CACHE_TTL
          : CACHE_SUCCESS_TTL,
        env.CACHE,
      );
    } else {
      await edgePut(cacheKey, JSON.stringify({ ok: false }), CACHE_FAILURE_TTL, env.CACHE);
    }
  } catch {
    /* cache write failure: ignore */
  }

  return result;
}

// Shared preamble for both resolve paths (single best stream for the
// bot, all servers/qualities for /api/resolve): TMDB title (English
// first) + provider search + strict title filter + Arabic fallback.
// Identical behaviour on both paths — do not diverge them.
// Strict title filter against every known name of the work (original,
// English display, Arabic display). A candidate matches when its title
// is one of the known names, or one known name followed only by
// season/episode metadata or by another known name (providers often
// list a show as "Arabic title + English title", e.g. "حب متنكر Love
// in Disguise"). Anything else — "Dexter: Resurrection" for "Dexter" —
// is still rejected: the remainder is neither metadata nor a known name.
export function matchesKnownTitles(candidateTitle: string, knownTitles: string[]): boolean {
  const cand = normalizeTitleForMatch(candidateTitle);
  if (!cand) return false;
  const known = [...new Set(knownTitles.map(normalizeTitleForMatch).filter(Boolean))];
  if (known.includes(cand)) return true;
  for (const k of known) {
    if (!cand.startsWith(k + " ")) continue;
    const rest = cand.slice(k.length).trim();
    if (SEASON_ONLY_SUFFIX.test(rest)) return true;
    if (known.includes(rest)) return true;
    for (const k2 of known) {
      if (k2 !== k && rest.startsWith(k2 + " ") && SEASON_ONLY_SUFFIX.test(rest.slice(k2.length).trim())) {
        return true;
      }
    }
  }
  return false;
}

// Lazy candidate rounds: each nextRound() runs ONE query title's
// provider search and returns its strict-matched candidates (or null
// when the query titles are exhausted). Rounds are lazy because a
// matched candidate is not a resolvable one — e.g. for "حب متنكر" the
// English round matches Akwam's "Love in Disguise" copy (whose file
// may be dead) while the working Laroza copy only appears in the
// Arabic round. Stopping at the first round with any match would
// declare the title unresolvable without ever trying the later round.
// The resolver drives the rounds and stops as soon as one resolves.
// Lazy candidate rounds: each nextRound() runs ONE query title's
// provider search and returns its strict-matched candidates (or null
// when the query titles are exhausted). Rounds are lazy because a
// matched candidate is not a resolvable one — e.g. for "حب متنكر" the
// English round matches Akwam's "Love in Disguise" copy (whose file
// may be dead) while the working Laroza copy only appears in the
// Arabic round. Stopping at the first round with any match would
// declare the title unresolvable without ever trying the later round.
// The resolver drives the rounds and stops as soon as one resolves.
async function fetchResolveCandidateRounds(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
): Promise<{
  enTitle: TmdbTitle;
  kind: MediaKind;
  unreliableEmbed: boolean;
  nextRound: () => Promise<Candidate[] | null>;
} | null> {
  const kind: MediaKind = type === "tv" ? "series" : "movie";
  const disabled = parseList(env.PROVIDERS_DISABLED);

  // English title first: providers match English titles more reliably.
  const enData = await fetchTmdbDetails(env, type, tmdbId, "en-US");
  const enTitle = tmdbTitleOf(enData, type);
  if (!enTitle) return null;
  const unreliableEmbed =
    type === "movie" && enData !== null && typeof enData === "object" && "imdb_id" in enData && !enData.imdb_id;

  // Arabic display title, fetched up front (one extra TMDB call): the
  // strict filter needs all known names before the first search round
  // runs — a candidate titled "حب متنكر Love in Disguise" starts with
  // the Arabic name, so the Arabic name must already be in the known
  // set when the English query round runs, or the filter drops it.
  const arData = await fetchTmdbDetails(env, type, tmdbId, "ar");
  const arTitle = tmdbTitleOf(arData, type);

  const knownTitles = [
    ...new Set(
      [enTitle.originalTitle, enTitle.title, arTitle?.title, arTitle?.originalTitle].filter(
        Boolean,
      ) as string[],
    ),
  ];
  // Query titles in order: original-language title, then the English
  // and Arabic display titles. For non-Latin originals (e.g. Korean
  // "나의 유죄인간" for "حب متنكر" / "Love in Disguise") providers list
  // the show by its Arabic/English name, so the original title alone
  // matches nothing.
  const queries = [
    ...new Set(
      [enTitle.originalTitle, enTitle.title, arTitle?.title, arTitle?.originalTitle].filter(
        Boolean,
      ) as string[],
    ),
  ];

  let i = 0;
  return {
    enTitle,
    kind,
    unreliableEmbed,
    nextRound: async (): Promise<Candidate[] | null> => {
      while (i < queries.length) {
        const q = queries[i++];
        // Direct-file providers only (see searchAllProviders): Akwam +
        // Laroza + the embed scraper (vidsrc/streamwish pages sometimes
        // carry a direct mp4) are the only ones that ever yield a
        // validated direct mp4, and searching all 9 providers per round
        // exhausts the Worker's subrequest budget before the working
        // copy is tried.
        const found = await searchAllProviders(q, kind, disabled, true, ["akwam", "laroza", "embed"], { pages: 2 });
        const matched = found.filter((c) => matchesKnownTitles(c.title, knownTitles));
        if (matched.length > 0) return matched;
      }
      return null;
    },
  };
}

// -----------------------------------------------------------------------------
// Multi-server / multi-quality resolve (for /api/resolve + bot codes)
// -----------------------------------------------------------------------------

export interface ResolvedQuality {
  quality: string;
  directVideoUrl: string;
  size?: string;
}

export interface ResolvedServer {
  name: string;
  qualities: ResolvedQuality[];
}

export interface ResolvedMulti {
  title: string;
  servers: ResolvedServer[];
  unreliableEmbed?: boolean;
}

export async function isUnreliableTmdbEmbed(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
): Promise<boolean> {
  if (type !== "movie") return false;
  const enData = await fetchTmdbDetails(env, type, tmdbId, "en-US");
  return enData !== null && typeof enData === "object" && "imdb_id" in enData && !enData.imdb_id;
}

// The EmbedWave embed fallback. Unlike vidsrc, EmbedWave plays
// inside a sandboxed iframe (verified live: Interstellar played with
// no ads/popups), so its popups/redirects stay blocked (no
// allow-popups / allow-top-navigation).
export function embedwaveUrl(
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): string {
  if (type === "tv") {
    return `https://embedwave.cc/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`;
  }
  return `https://embedwave.cc/embed/movie/${tmdbId}`;
}

export interface BackupEmbedServer {
  name: string;
  embed: true;
  qualities: Array<{ quality: string; stream: string }>;
}

/**
 * Build ordered list of sandbox-compatible embed servers (EmbedWave primary + 2 backups).
 * Every server here was verified to play inside the site's sandboxed iframe
 * (no allow-popups). nontongo/vidfast/multiembed were removed: they detect the
 * sandbox and render "Please Disable Sandbox" instead of a player.
 */
export function buildEmbedServers(
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): BackupEmbedServer[] {
  const s = season || 1;
  const e = episode || 1;
  const tv = type === "tv";
  const defs: Array<[string, string]> = [
    ["embedwave", embedwaveUrl(type, tmdbId, s, e)],
    ["2embed", tv ? `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}` : `https://www.2embed.cc/embed/${tmdbId}`],
    ["2embed-2", tv ? `https://www.2embed.skin/embedtv/${tmdbId}&s=${s}&e=${e}` : `https://www.2embed.skin/embed/${tmdbId}`],
  ];
  return defs.map(([name, stream]) => ({
    name,
    embed: true,
    qualities: [{ quality: "HD", stream }],
  }));
}

// Do two quality labels name the same resolution? ("720p HD" vs "720p")
export function qualityMatches(a: string, b: string): boolean {
  const ra = a.match(/(\d{3,4})/)?.[1];
  const rb = b.match(/(\d{3,4})/)?.[1];
  if (ra && rb) return ra === rb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const SERVER_CACHE_SUCCESS_TTL = 6 * 3600; // 6 hours
const SERVER_CACHE_FAILURE_TTL = 30 * 60; // 30 minutes

// Provider direct links are time-bound, and a resolve cached longer
// than a link's remaining life keeps serving dead links: the player
// then spins on a URL that can never deliver data (verified live
// 2026-11-17: a 5.7h-old cached VisionQuest link 403s, a fresh link
// from the same page returns 206; 2026-11-19: Interstellar loaded
// ~15 min and never opened on a stale cached link). Laroza's
// okprimeone links are signed and expire after 2h (e=7200 in the
// URL); Akwam's downet links carry a fixed expiry timestamp in the
// path (~24h from creation). Cache resolves that carry such links for
// 1h only, so the link is always served fresh — 1h is also comfortably
// below the 3h life of the worker-signed /stream?t= token minted from
// the cached URL on every /api/resolve request, so a cached resolve
// can never hand the player a dead stream URL. Generic mp4 hosts with
// no expiry in the URL keep the 6h TTL.
const SIGNED_LINK_CACHE_TTL = 1 * 3600; // 1 hour

export function resolveCacheTtl(result: ResolvedMulti): number {
  const hasTimeBoundLinks = result.servers.some((s) =>
    s.qualities.some((q) => isTimeBoundDirectUrl(q.directVideoUrl)),
  );
  return hasTimeBoundLinks ? SIGNED_LINK_CACHE_TTL : SERVER_CACHE_SUCCESS_TTL;
}

// Like resolveByTmdb, but returns every validated quality of the first
// working source (native server) instead of only the best stream. The
// embedwave server is added by the /api/resolve handler, not cached here.
// Null when nothing validates (callers fall back to embedwave).
export async function resolveServersByTmdb(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<ResolvedMulti | null> {
  // srv11/dl3: dubbed sources are now dropped; old entries may hold dubs.
  // Bumped to srv10: after the stale-cache fix — the srv9: entries
  // cached before it can hold an Akwam resolve whose downet link is
  // near/past its expiry (links carry a fixed expiry timestamp, the
  // cache kept them 6h) and must not be reused. (srv9 itself was the
  // signed-link cache fix: srv8 entries could hold a Laroza resolve
  // whose okprimeone link expired (links live 2h, the cache kept them
  // 6h). srv8 was the direct-providers fix: srv7 entries could hold a
  // resolve that ran out of the Worker's subrequest budget mid-loop,
  // e.g. حب متنكر cached as "no download" because Laroza's details
  // came back empty and round 3 never ran.)
  const cacheKey = `srv11:${type}:${tmdbId}:${season || 0}:${episode || 0}`;

  try {
    const cached = await edgeGet(cacheKey, env.CACHE);
    if (cached) {
      const parsed = JSON.parse(cached) as { ok: boolean } & ResolvedMulti;
      if (parsed && parsed.ok) {
        return {
          title: parsed.title,
          servers: parsed.servers,
          ...(parsed.unreliableEmbed ? { unreliableEmbed: true } : {}),
        };
      }
      if (parsed && parsed.ok === false) return null;
    }
  } catch {
    /* cache read failure: fall through to live resolve */
  }

  const result = await resolveServersByTmdbUncached(env, type, tmdbId, season, episode);

  try {
    if (result) {
      await edgePut(
        cacheKey,
        JSON.stringify({ ok: true, ...result }),
        resolveCacheTtl(result),
        env.CACHE,
      );
    } else {
      await edgePut(cacheKey, JSON.stringify({ ok: false }), SERVER_CACHE_FAILURE_TTL, env.CACHE);
    }
  } catch {
    /* cache write failure: ignore */
  }

  return result;
}

const MAX_DIRECT_SERVERS = 2;

async function resolveServersByTmdbUncached(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<ResolvedMulti | null> {
  const found = await fetchResolveCandidateRounds(env, type, tmdbId);
  if (!found) return null;
  const { enTitle, kind, unreliableEmbed, nextRound } = found;
  // The same copy can surface in two rounds (e.g. Laroza's in both the
  // English and the Arabic round) - try each URL once.
  const tried = new Set<string>();
  const servers: ResolvedServer[] = [];
  const usedSites = new Set<string>();
  const seenDirectUrls = new Set<string>();

  let round: Candidate[] | null;
  while ((round = await nextRound())) {
    while (servers.length < MAX_DIRECT_SERVERS) {
      const batch: Candidate[] = [];
      const batchSites = new Set<string>();
      for (const candidate of round) {
        if (tried.has(candidate.url) || usedSites.has(candidate.site) || batchSites.has(candidate.site)) {
          continue;
        }
        // Same declared season/episode guard: never resolve from a page that declares a different season or episode.
        if (type === "tv") {
          const declared = parseSeasonEpisode(candidate.title);
          if (season !== undefined && declared.season !== undefined && declared.season !== season) continue;
          if (episode !== undefined && declared.episode !== undefined && declared.episode !== episode) continue;
        }
        tried.add(candidate.url);
        batchSites.add(candidate.site);
        batch.push(candidate);
        if (batch.length >= MAX_DIRECT_SERVERS - servers.length) break;
      }
      if (batch.length === 0) break;

      const resolvedBatch = await Promise.all(
        batch.map(async (candidate) => {
          const provider = findProvider(candidate.site);
          if (!provider) return null;
          try {
            const details = await provider.getDetails(candidate);
            const targetUrl = await pickTargetUrl(provider, details, type, season, episode, candidate.url);
            if (!targetUrl) return null;
            // Only non-native embed candidates fall back to Akwam title lookup when no native server exists yet.
            const allowFallback = servers.length === 0 && candidate.site !== "akwam" && candidate.site !== "laroza";
            const streams = await resolveAllDirectStreams(
              provider,
              targetUrl,
              enTitle.originalTitle,
              kind,
              season,
              episode,
              allowFallback,
            );
            return { candidate, provider, streams };
          } catch {
            return null;
          }
        }),
      );

      for (const item of resolvedBatch) {
        if (!item || servers.length >= MAX_DIRECT_SERVERS) continue;
        const { candidate, provider, streams } = item;
        const uniqueStreams = streams.filter((s) => !seenDirectUrls.has(s.directVideoUrl));
        if (uniqueStreams.length > 0) {
          usedSites.add(candidate.site);
          for (const s of uniqueStreams) seenDirectUrls.add(s.directVideoUrl);
          servers.push({
            name: provider.label || "مباشر",
            qualities: uniqueStreams.map((s) => ({
              quality: s.quality,
              directVideoUrl: s.directVideoUrl,
              size: s.size,
            })),
          });
        }
      }
    }
    if (servers.length > 0) {
      return {
        title: enTitle.title,
        servers,
        ...(unreliableEmbed ? { unreliableEmbed: true } : {}),
      };
    }
  }

  return null;
}

async function resolveByTmdbUncached(
  env: Env,
  type: "movie" | "tv",
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<ResolvedDirect | null> {
  const kind: MediaKind = type === "tv" ? "series" : "movie";
  const found = await fetchResolveCandidateRounds(env, type, tmdbId);
  if (!found) return null;
  const { enTitle, nextRound } = found;
  const tried = new Set<string>();

  let round: Candidate[] | null;
  while ((round = await nextRound())) {
    for (const candidate of round) {
      if (tried.has(candidate.url)) continue;
      tried.add(candidate.url);
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
  // candidate (or falls back to embedwave).
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
