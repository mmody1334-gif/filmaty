import type { Env } from "./env.ts";
import { handleStreamProxy } from "./engine/proxy.ts";
import { embedwaveUrl, qualityMatches, resolveServersByTmdb, vidlinkUrl } from "./engine/resolve.ts";
import {
  BOT_CODE_TTL_SECONDS,
  botCodeKey,
  generateBotCode,
  type BotCodePayload,
} from "./engine/botcode.ts";
import { searchTitles } from "./engine/search.ts";
import { findProvider } from "./providers/index.ts";
import { BROWSE_COLLECTIONS, BROWSE_LANGS, browseTitles } from "./engine/browse.ts";
import { getHome, recordView } from "./engine/home.ts";
import { signToken, verifyToken } from "./engine/token.ts";
import { renderPlayerHtml } from "./player/html.ts";
import { FILMATY_WEBAPP_HTML } from "./player/webapp-html.ts";
import { handleTelegramUpdate } from "./telegram/handlers.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve Filmaty WebApp directly at root
    if (url.pathname === "/" || url.pathname === "" || url.pathname === "/app" || url.pathname === "/web") {
      return new Response(FILMATY_WEBAPP_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "filmaty",
          version: "2.0.0",
          time: new Date().toISOString(),
        }),
        {
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    // CORS preflight for API routes (index.html is served from GitHub Pages,
    // a different origin than this Worker).
    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Resolve a TMDB title to a direct mp4 stream (ad-free native player
    // + direct download). GET /api/resolve?type=movie|tv&id=123&s=1&e=2
    if (url.pathname === "/api/resolve" && request.method === "GET") {
      return await handleApiResolve(request, env, url);
    }

    if (url.pathname === "/api/bot-code" && request.method === "POST") {
      return handleApiBotCode(request, env);
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      return handleApiSearch(request, env, url);
    }

    // TEMPORARY diagnostics (added 2026-11-16 while tracing why حب متنكر
    // resolves from a VM but not from the Worker): runs ONE provider's
    // search and returns its candidate titles. Read-only, no secrets.
    // Remove once the diagnosis is done.
    if (url.pathname === "/api/debug-search" && request.method === "GET") {
      const site = url.searchParams.get("site") || "";
      const q = url.searchParams.get("q") || "";
      const kind = url.searchParams.get("kind") === "movie" ? "movie" : "series";
      const provider = findProvider(site);
      if (!provider || !q) {
        return new Response(JSON.stringify({ ok: false, error: "bad site or q" }), {
          status: 400,
          headers: corsHeaders(),
        });
      }
      try {
        const candidates = await provider.search(q, kind as "movie" | "series");
        return new Response(
          JSON.stringify({
            ok: true,
            site,
            query: q,
            kind,
            count: candidates.length,
            candidates: candidates.slice(0, 5).map((c) => ({ title: c.title, url: c.url })),
          }),
          { headers: corsHeaders() },
        );
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, site, query: q, error: String(err?.message || err) }), {
          status: 500,
          headers: corsHeaders(),
        });
      }
    }

    if (url.pathname === "/api/browse" && request.method === "GET") {
      return handleApiBrowse(request, env, url);
    }

    if (url.pathname === "/api/view" && request.method === "POST") {
      return handleApiView(request, env);
    }

    if (url.pathname === "/api/home" && request.method === "GET") {
      return handleApiHome(request, env);
    }

    // Telegram webhook handler
    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      // Validate webhook secret token if configured
      if (env.WEBHOOK_SECRET) {
        const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
        if (secretHeader !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 403 });
        }
      }

      try {
        const update = await request.json();
        // Handle update
        return await handleTelegramUpdate(update, env);
      } catch (err: any) {
        console.error("Webhook processing error:", err);
        return new Response("Bad Request", { status: 400 });
      }
    }

    // WebApp Video Player
    if (url.pathname === "/watch") {
      const token = url.searchParams.get("t");
      if (!token) {
        return new Response("Missing video token", { status: 400 });
      }

      const payload = await verifyToken(token, env.SIGNING_SECRET);
      if (!payload) {
        return new Response("Invalid or expired video session", { status: 403 });
      }

      const publicBase = env.PUBLIC_BASE || url.origin;
      const streamUrl =
        payload.k === "embed"
          ? payload.u
          : `${publicBase}/stream?t=${encodeURIComponent(token)}`;

      const html = renderPlayerHtml({
        title: payload.n || "مشاهدة الفيديو",
        streamUrl,
        downloadUrl: payload.k === "mp4" ? streamUrl : undefined,
        kind: payload.k,
      });

      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }

    // Byte-range video streaming proxy
    if (url.pathname === "/stream") {
      return handleStreamProxy(request, env.SIGNING_SECRET);
    }

    return new Response("Filmaty Bot API - Not Found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled background maintenance: keep domains warm and purge stale caches
    console.log("Filmaty cron running:", new Date().toISOString());
  },
};

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "*",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

// POST /api/view { type, id } -> { ok, count }. Counts one view of a
// title (no per-user tracking, no auth); maintains the cached top list.
async function handleApiView(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid json" }, 400);
  }
  const type = body?.type;
  const id = Number(body?.id);
  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ ok: false, error: "invalid type" }, 400);
  }
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse({ ok: false, error: "invalid id" }, 400);
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip, "view"))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }
  const { count } = await recordView(env, type, id);
  return jsonResponse({ ok: true, count }, 200);
}

// GET /api/home -> { ok, mostWatched, topRated } (KV-cached 10 min).
async function handleApiHome(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip, "home"))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }
  const { mostWatched, topRated } = await getHome(env);
  return jsonResponse({ ok: true, mostWatched, topRated }, 200);
}

// GET /api/browse?type=movie|tv&lang=ar|en|hi|tr|ko|es|fr|ja&origin=US&sort=popular|top_rated&page=1..5&collection=marvel|netflix
// lang and origin are optional: omitted lang = global (no language
// filter), omitted origin = any origin country.
// TMDB discover behind the Worker (cached 10 min). { ok, results, total_pages }.
async function handleApiBrowse(request: Request, env: Env, url: URL): Promise<Response> {
  const type = url.searchParams.get("type");
  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ ok: false, error: "invalid type" }, 400);
  }
  const langRaw = url.searchParams.get("lang");
  let lang: (typeof BROWSE_LANGS)[number] | undefined;
  if (langRaw !== null) {
    if (!(BROWSE_LANGS as readonly string[]).includes(langRaw)) {
      return jsonResponse({ ok: false, error: "invalid lang" }, 400);
    }
    lang = langRaw as (typeof BROWSE_LANGS)[number];
  }
  const originRaw = url.searchParams.get("origin");
  let origin: string | undefined;
  if (originRaw !== null) {
    if (!/^[A-Za-z]{2}$/.test(originRaw)) {
      return jsonResponse({ ok: false, error: "invalid origin" }, 400);
    }
    origin = originRaw.toUpperCase();
  }
  const sort = url.searchParams.get("sort") || "popular";
  if (sort !== "popular" && sort !== "top_rated") {
    return jsonResponse({ ok: false, error: "invalid sort" }, 400);
  }
  const pageRaw = url.searchParams.get("page") || "1";
  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 1 || page > 5) {
    return jsonResponse({ ok: false, error: "invalid page" }, 400);
  }
  const collection = url.searchParams.get("collection");
  if (collection !== null && !(BROWSE_COLLECTIONS as readonly string[]).includes(collection)) {
    return jsonResponse({ ok: false, error: "invalid collection" }, 400);
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip, "browse"))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }
  const { results, total_pages } = await browseTitles(env, {
    type,
    lang,
    origin,
    sort,
    page,
    collection: (collection as (typeof BROWSE_COLLECTIONS)[number]) || undefined,
  });
  return jsonResponse({ ok: true, results, total_pages }, 200);
}

// GET /api/search?q= — TMDB in ar + en-US merged/deduped, provider
// fallback when TMDB returns nothing. { ok, results, source }.
async function handleApiSearch(request: Request, env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    return jsonResponse({ ok: false, error: "missing q" }, 400);
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip, "search"))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }
  const { results, source } = await searchTitles(env, q);
  return jsonResponse({ ok: true, results, source }, 200);
}

// POST /api/bot-code { type, id, s?, e?, quality? } -> { ok, code }.
// Only issues a code for a title/episode/quality that actually resolves
// (same resolver as /api/resolve). Code is valid for 1 hour.
async function handleApiBotCode(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid json" }, 400);
  }

  const type = body?.type;
  const id = Number(body?.id);
  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ ok: false, error: "invalid type" }, 400);
  }
  if (!Number.isInteger(id) || id <= 0) {
    return jsonResponse({ ok: false, error: "invalid id" }, 400);
  }
  const s = Number(body?.s);
  const e = Number(body?.e);
  const seasonNum = Number.isInteger(s) && s > 0 ? s : undefined;
  const episodeNum = Number.isInteger(e) && e > 0 ? e : undefined;

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip, "bot-code"))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }

  const resolved = await resolveServersByTmdb(env, type, id, seasonNum, episodeNum);
  if (!resolved || resolved.servers.length === 0) {
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  }
  const qualities = resolved.servers[0].qualities;
  const requestedQuality = typeof body?.quality === "string" ? body.quality : undefined;
  const quality = requestedQuality
    ? qualities.find((q) => qualityMatches(q.quality, requestedQuality))
    : qualities[0];
  if (!quality) {
    return jsonResponse({ ok: false, error: "quality_not_found" }, 404);
  }

  // Generate a unique code (collision-checked in KV, up to 5 attempts).
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateBotCode();
    try {
      const existing = await env.CACHE?.get(botCodeKey(candidate));
      if (!existing) {
        code = candidate;
        break;
      }
    } catch {
      code = candidate;
      break;
    }
  }
  if (!code) {
    return jsonResponse({ ok: false, error: "try_again" }, 503);
  }

  const payload: BotCodePayload = {
    type,
    tmdbId: id,
    season: seasonNum,
    episode: episodeNum,
    quality: quality.quality,
  };
  try {
    await env.CACHE?.put(botCodeKey(code), JSON.stringify(payload), {
      expirationTtl: BOT_CODE_TTL_SECONDS,
    });
  } catch {
    return jsonResponse({ ok: false, error: "try_again" }, 503);
  }
  return jsonResponse({ ok: true, code }, 200);
}

// Simple KV rate limit: max 30 requests per IP per 10 min per bucket.
// Fails open (allows the request) if KV is unavailable.
async function checkResolveRateLimit(env: Env, ip: string, bucket = "resolve"): Promise<boolean> {
  try {
    if (!env.CACHE) return true;
    const key = `rl:${bucket}:${ip}`;
    const raw = await env.CACHE.get(key);
    const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
    if (count >= 30) return false;
    await env.CACHE.put(key, String(count + 1), { expirationTtl: 600 });
    return true;
  } catch {
    return true;
  }
}

async function handleApiResolve(request: Request, env: Env, url: URL): Promise<Response> {
  const type = url.searchParams.get("type");
  const idRaw = url.searchParams.get("id");
  const id = idRaw ? Number(idRaw) : Number.NaN;

  if (type !== "movie" && type !== "tv") {
    return jsonResponse({ ok: false, error: "invalid type" }, 400);
  }
  if (!idRaw || !Number.isInteger(id) || id <= 0) {
    return jsonResponse({ ok: false, error: "invalid id" }, 400);
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }

  const sRaw = url.searchParams.get("s");
  const eRaw = url.searchParams.get("e");
  const season = sRaw ? Number(sRaw) : undefined;
  const episode = eRaw ? Number(eRaw) : undefined;
  const seasonNum =
    season !== undefined && Number.isInteger(season) && season > 0 ? season : undefined;
  const episodeNum =
    episode !== undefined && Number.isInteger(episode) && episode > 0 ? episode : undefined;

  const publicBase = env.PUBLIC_BASE || url.origin;
  const vidlink = vidlinkUrl(type, id, seasonNum, episodeNum);
  const vidlinkServer = {
    name: "vidlink",
    qualities: [{ quality: "HD", stream: vidlink }],
  };
  // EmbedWave sits between the native server and vidlink: it plays inside
  // a sandboxed iframe (popups/redirects blocked), while vidlink is the
  // last-resort unsandboxed fallback.
  const embedwave = embedwaveUrl(type, id, seasonNum, episodeNum);
  const embedwaveServer = {
    name: "embedwave",
    qualities: [{ quality: "HD", stream: embedwave }],
  };

  const resolved = await resolveServersByTmdb(env, type, id, seasonNum, episodeNum);
  if (!resolved) {
    // No validated native stream: top-level ok stays false (existing
    // behaviour) so the frontend falls back to the embed players, but
    // both embed servers are still listed.
    return jsonResponse({ ok: false, servers: [embedwaveServer, vidlinkServer] }, 404);
  }

  // Sign one stream/download token per quality (tokens live 3h).
  const servers: Array<{
    name: string;
    qualities: Array<{ quality: string; stream: string; download?: string; size?: string }>;
  }> = [];
  for (const server of resolved.servers) {
    const qualities: Array<{ quality: string; stream: string; download?: string; size?: string }> = [];
    for (const q of server.qualities) {
      const token = await signToken(
        {
          u: q.directVideoUrl,
          n: resolved.title,
          k: "mp4",
          e: Math.floor(Date.now() / 1000) + 3 * 3600,
        },
        env.SIGNING_SECRET,
      );
      const stream = `${publicBase}/stream?t=${encodeURIComponent(token)}`;
      qualities.push({
        quality: q.quality,
        stream,
        download: `${stream}&dl=1`,
        ...(q.size ? { size: q.size } : {}),
      });
    }
    servers.push({ name: server.name, qualities });
  }
  servers.push(embedwaveServer);
  servers.push(vidlinkServer);

  // Top-level fields stay the default: best quality of the first server.
  const best = servers[0].qualities[0];
  return jsonResponse(
    {
      ok: true,
      title: resolved.title,
      quality: best.quality,
      stream: best.stream,
      download: best.download,
      servers,
    },
    200,
  );
}
