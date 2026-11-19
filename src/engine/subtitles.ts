import type { Env } from "../env.ts";
import { tmdbApiKey } from "./search.ts";

const TMDB_BASE = "https://api.themoviedb.org/3";
const SUBTITLE_INDEX_TTL = 6 * 3600;
const MAX_SUB_BYTES = 2 * 1024 * 1024;
const ALLOWED_SUB_HOST =
  /^(?:opensubtitles-v3\.strem\.io|dl\.opensubtitles\.org|[a-z0-9-]+\.strem\.io|[a-z0-9-]+\.opensubtitles\.org)$/i;

export interface SubtitleTrackItem {
  id: string;
  lang: string;
  langCode: "ar" | "en";
  label: string;
  proxyUrl: string;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResp(body: unknown, status = 200, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(maxAge > 0 ? { "cache-control": `public, max-age=${maxAge}` } : {}),
      ...corsHeaders(),
    },
  });
}

/** Validate remote subtitle URL against explicit HTTPS OpenSubtitles/Stremio host allowlist. */
export function isAllowedSubtitleUrl(rawUrl: string): URL | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!ALLOWED_SUB_HOST.test(u.hostname)) return null;
  return u;
}

/** Convert SubRip (.srt) text into standard HTML5 WebVTT (.vtt). */
export function srtToVtt(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!cleaned) return "WEBVTT\n\n";
  if (/^WEBVTT\b/i.test(cleaned)) return cleaned + "\n";

  const lines = cleaned.split("\n");
  const out: string[] = ["WEBVTT", ""];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || "";
    // Skip bare cue sequence number immediately preceding a timestamp line.
    if (/^\d+$/.test(line.trim()) && /-->/.test(next)) {
      continue;
    }
    if (line.includes("-->")) {
      out.push(
        line.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"),
      );
    } else {
      out.push(line);
    }
  }
  return out.join("\n") + "\n";
}

function decodeSubtitleBytes(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  const badCount = (utf8.match(/\uFFFD/g) || []).length;
  if (badCount >= 3) {
    try {
      return new TextDecoder("windows-1256").decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

async function fetchImdbId(env: Env, type: "movie" | "tv", id: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${TMDB_BASE}/${type}/${id}/external_ids?api_key=${encodeURIComponent(tmdbApiKey(env))}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { imdb_id?: string } | null;
    const imdb = String(data?.imdb_id || "").trim();
    return /^tt\d{5,}$/.test(imdb) ? imdb : null;
  } catch {
    return null;
  }
}

function mapLangCode(lang: string): "ar" | "en" | null {
  const norm = (lang || "").trim().toLowerCase();
  if (norm === "ara" || norm === "ar" || norm === "arb" || norm.startsWith("arabic")) return "ar";
  if (norm === "eng" || norm === "en" || norm.startsWith("english")) return "en";
  return null;
}

async function fetchSafeSubtitleResponse(initialUrl: URL): Promise<Response | "forbidden" | null> {
  let current: URL = initialUrl;
  for (let hop = 0; hop <= 2; hop++) {
    const res = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(9000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop === 2) return null;
      let nextUrl: URL;
      try {
        nextUrl = new URL(loc, current);
      } catch {
        return "forbidden";
      }
      const checked = isAllowedSubtitleUrl(nextUrl.toString());
      if (!checked) return "forbidden";
      current = checked;
      continue;
    }
    return res;
  }
  return null;
}

/**
 * GET /api/subtitles:
 * 1) ?src=<allowed_url> -> fetches SRT/VTT from allowlisted host, converts to WebVTT with CORS.
 * 2) ?type=movie|tv&id=<tmdb>[&s=1&e=1] -> lists Arabic & English subtitle tracks via Stremio OpenSubtitles v3.
 */
export async function handleApiSubtitles(env: Env, url: URL): Promise<Response> {
  const srcRaw = (url.searchParams.get("src") || "").trim();
  if (srcRaw) {
    const safeUrl = isAllowedSubtitleUrl(srcRaw);
    if (!safeUrl) {
      return jsonResp({ ok: false, error: "forbidden_host" }, 403);
    }
    try {
      const upstream = await fetchSafeSubtitleResponse(safeUrl);
      if (upstream === "forbidden") {
        return jsonResp({ ok: false, error: "forbidden_host" }, 403);
      }
      if (!upstream || !upstream.ok) {
        return jsonResp({ ok: false, error: "subtitle_upstream_error" }, 502);
      }
      const len = Number(upstream.headers.get("content-length") || "0");
      if (len > MAX_SUB_BYTES) {
        return jsonResp({ ok: false, error: "subtitle_too_large" }, 413);
      }
      const buf = await upstream.arrayBuffer();
      if (buf.byteLength > MAX_SUB_BYTES) {
        return jsonResp({ ok: false, error: "subtitle_too_large" }, 413);
      }
      const vtt = srtToVtt(decodeSubtitleBytes(buf));
      return new Response(vtt, {
        status: 200,
        headers: {
          "content-type": "text/vtt; charset=utf-8",
          "cache-control": "public, max-age=86400",
          ...corsHeaders(),
        },
      });
    } catch {
      return jsonResp({ ok: false, error: "subtitle_fetch_failed" }, 502);
    }
  }

  const type = url.searchParams.get("type");
  const id = Number(url.searchParams.get("id") || "");
  if ((type !== "movie" && type !== "tv") || !Number.isInteger(id) || id <= 0) {
    return jsonResp({ ok: false, error: "invalid_params" }, 400);
  }
  const sNum = Number(url.searchParams.get("s") || "1");
  const eNum = Number(url.searchParams.get("e") || "1");
  const s = type === "tv" && Number.isInteger(sNum) && sNum > 0 ? sNum : 1;
  const e = type === "tv" && Number.isInteger(eNum) && eNum > 0 ? eNum : 1;

  const cacheKey = type === "tv" ? `subidx:v1:tv:${id}:${s}:${e}` : `subidx:v1:movie:${id}`;
  try {
    const cached = await env.CACHE?.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.tracks)) {
        return jsonResp({ ok: true, ...parsed }, 200, 1800);
      }
    }
  } catch {
    /* ignore corrupt cache */
  }

  const imdbId = await fetchImdbId(env, type, id);
  if (!imdbId) {
    return jsonResp({ ok: true, imdbId: null, tracks: [] }, 200, 600);
  }

  const stremioUrl =
    type === "tv"
      ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${s}:${e}.json`
      : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;

  const publicBase = env.PUBLIC_BASE || url.origin;
  const tracks: SubtitleTrackItem[] = [];
  try {
    const res = await fetch(stremioUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        subtitles?: Array<{ id?: string; lang?: string; url?: string }>;
      } | null;
      const ar: SubtitleTrackItem[] = [];
      const en: SubtitleTrackItem[] = [];
      for (const item of data?.subtitles || []) {
        const lc = mapLangCode(String(item?.lang || ""));
        const safeSub = isAllowedSubtitleUrl(String(item?.url || ""));
        if (!lc || !safeSub) continue;
        const bucket = lc === "ar" ? ar : en;
        if (bucket.length >= 3) continue;
        const idx = bucket.length + 1;
        bucket.push({
          id: String(item.id || `${lc}-${idx}`),
          lang: lc,
          langCode: lc,
          label: lc === "ar" ? `العربية (${idx})` : `English (${idx})`,
          proxyUrl: `${publicBase}/api/subtitles?src=${encodeURIComponent(safeSub.toString())}`,
        });
        if (ar.length >= 3 && en.length >= 3) break;
      }
      tracks.push(...ar, ...en);
    }
  } catch {
    /* fall through with empty tracks */
  }

  const payload = { imdbId, tracks };
  try {
    await env.CACHE?.put(cacheKey, JSON.stringify(payload), {
      expirationTtl: SUBTITLE_INDEX_TTL,
    });
  } catch {
    /* ignore KV failure */
  }

  return jsonResp({ ok: true, ...payload }, 200, 1800);
}
