import type { Env } from "../env.ts";
import { tmdbApiKey } from "./search.ts";
import { edgeGet, edgePut } from "./edge-cache.ts";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_PROXY_TTL = 1800;

const ALLOWED_DETAIL_PATH = /^\/(movie|tv)\/\d+$/;
const ALLOWED_TMDB_PATHS: RegExp[] = [
  ALLOWED_DETAIL_PATH,
  /^\/(movie|tv)\/\d+\/(videos|credits|images|similar|release_dates|content_ratings|external_ids)$/,
  /^\/tv\/\d+\/season\/\d+$/,
  /^\/collection\/\d+$/,
  /^\/person\/\d+(\/combined_credits)?$/,
  /^\/(movie|tv)\/(popular|top_rated|upcoming|airing_today|on_the_air)$/,
  /^\/trending\/(all|movie|tv)\/(day|week)$/,
];

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonErr(error: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

/** Validate a TMDB relative path (normalized with leading slash) against the safe allowlist. */
export function normalizeAllowedTmdbPath(rawPath: string): string | null {
  const trimmed = (rawPath || "").trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("?") || trimmed.includes("#") || trimmed.includes("://")) {
    return null;
  }
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return ALLOWED_TMDB_PATHS.some((re) => re.test(normalized)) ? normalized : null;
}

/**
 * GET /api/tmdb?path=...&lang=ar|en-US&append=translations
 * Preserves KV caching (`tmdb1:<path>:<lang>:<append>`) and strict 400 validation
 * while supporting episode seasons (#6), collections/cast/credits (#7), ratings (#22), and calendar (#17).
 */
export async function handleApiTmdbProxy(
  _request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const path = normalizeAllowedTmdbPath(url.searchParams.get("path") || "");
  if (!path) {
    return jsonErr("invalid_tmdb_path", 400);
  }

  const lang = (url.searchParams.get("lang") || "ar").trim();
  if (lang !== "ar" && lang !== "en-US") {
    return jsonErr("invalid_lang", 400);
  }

  const append = (url.searchParams.get("append") || "").trim();
  if (append) {
    if (append !== "translations" || !ALLOWED_DETAIL_PATH.test(path)) {
      return jsonErr("invalid_append", 400);
    }
  }

  const region = (url.searchParams.get("region") || "").trim().toUpperCase();
  const hasValidRegion = /^[A-Z]{2}$/.test(region);
  const page = Number(url.searchParams.get("page") || "");
  const hasValidPage = Number.isInteger(page) && page >= 1 && page <= 50;

  const cacheKey = `tmdb1:${path}:${lang}:${append}${hasValidRegion ? `:r:${region}` : ""}${hasValidPage ? `:p:${page}` : ""}`;
  try {
    const cached = await edgeGet(cacheKey, env.CACHE);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=1800",
          ...corsHeaders(),
        },
      });
    }
  } catch {
    /* ignore KV read errors */
  }

  const upstream = new URL(`${TMDB_BASE}${path}`);
  upstream.searchParams.set("api_key", tmdbApiKey(env));
  upstream.searchParams.set("language", lang);
  if (append) {
    upstream.searchParams.set("append_to_response", append);
  }
  if (hasValidRegion) {
    upstream.searchParams.set("region", region);
  }
  if (hasValidPage) {
    upstream.searchParams.set("page", String(page));
  }

  try {
    const res = await fetch(upstream.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return jsonErr("tmdb_error", res.status === 404 ? 404 : 502);
    }
    const text = await res.text();
    try {
      await edgePut(cacheKey, text, TMDB_PROXY_TTL, env.CACHE);
    } catch {
      /* ignore KV write errors */
    }
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=1800",
        ...corsHeaders(),
      },
    });
  } catch {
    return jsonErr("tmdb_unreachable", 502);
  }
}
