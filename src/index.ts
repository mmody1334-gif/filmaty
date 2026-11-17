import type { Env } from "./env.ts";
import { handleStreamProxy } from "./engine/proxy.ts";
import { embedwaveUrl, qualityMatches, resolveServersByTmdb } from "./engine/resolve.ts";
import {
  BOT_CODE_TTL_SECONDS,
  botCodeKey,
  generateBotCode,
  type BotCodePayload,
} from "./engine/botcode.ts";
import { searchTitles } from "./engine/search.ts";
import { BROWSE_COLLECTIONS, BROWSE_LANGS, browseTitles } from "./engine/browse.ts";
import { getHome, recordView } from "./engine/home.ts";
import { signToken, verifyToken } from "./engine/token.ts";
import { downloadDisplayName } from "./engine/filenames.ts";
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


    if (url.pathname === "/api/browse" && request.method === "GET") {
      return handleApiBrowse(request, env, url);
    }

    if (url.pathname === "/api/view" && request.method === "POST") {
      return handleApiView(request, env);
    }

    if (url.pathname === "/api/home" && request.method === "GET") {
      return handleApiHome(request, env);
    }

    if (url.pathname === "/api/tv-command" && request.method === "POST") {
      return handleApiTvCommandPost(request, env);
    }

    if (url.pathname === "/api/tv-command" && request.method === "GET") {
      return handleApiTvCommandGet(request, env, url);
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
        downloadUrl: payload.k === "mp4" ? `${streamUrl}&dl=1` : undefined,
        directUrl: payload.k === "mp4" && isCorsDirectCdn(payload.u) ? payload.u : undefined,
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

// TV remote: the phone controls the TV through KV.
// The TV shows a QR with a random 6-char session code; the phone scans it,
// opens the remote page, and every pick is POSTed here. The TV polls the
// GET endpoint every few seconds and plays the newest command it hasn't
// applied yet. Commands live 15 minutes in KV. Session codes are random;
// the worst a stranger who guessed one could do is make your TV play a
// film, and the stored value is only a play command (a TMDB id), nothing
// private.
const TV_COMMAND_TTL_SECONDS = 900;

function tvCommandKey(session: string): string {
  return `tv:${session}`;
}

function isValidTvSession(session: unknown): session is string {
  return typeof session === "string" && /^[A-Za-z0-9]{6}$/.test(session);
}

type TvCommand = {
  id: string; // unique per command, generated by the phone
  action: "play" | "toggle" | "close" | "seek" | "mute" | "next";
  type?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  delta?: number;
  ts: number;
};

// POST /api/tv-command { session, action, type?, id?, s?, e?, delta?, cmdId? }
// -> { ok: true, id }. The phone sends one POST per pick, so it shares
// the usual 30-requests-per-10-minutes bucket; the TV's poll (GET) is
// exempt — it fires every 10s and that bucket would cut it off within a
// minute.
async function handleApiTvCommandPost(request: Request, env: Env): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid json" }, 400);
  }
  const session = body?.session;
  if (!isValidTvSession(session)) {
    return jsonResponse({ ok: false, error: "invalid session" }, 400);
  }
  const action = body?.action;
  if (
    action !== "play" &&
    action !== "toggle" &&
    action !== "close" &&
    action !== "seek" &&
    action !== "mute" &&
    action !== "next"
  ) {
    return jsonResponse({ ok: false, error: "invalid action" }, 400);
  }
  const cmd: TvCommand = {
    id:
      typeof body?.cmdId === "string" && body.cmdId
        ? body.cmdId
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    ts: Date.now(),
  };
  if (action === "play") {
    const type = body?.type;
    const tmdbId = Number(body?.id);
    if (type !== "movie" && type !== "tv") {
      return jsonResponse({ ok: false, error: "invalid type" }, 400);
    }
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return jsonResponse({ ok: false, error: "invalid id" }, 400);
    }
    cmd.type = type;
    cmd.tmdbId = tmdbId;
    const s = Number(body?.s);
    const e = Number(body?.e);
    if (Number.isInteger(s) && s > 0) cmd.season = s;
    if (Number.isInteger(e) && e > 0) cmd.episode = e;
  } else if (action === "seek") {
    const delta = Number(body?.delta);
    if (!Number.isFinite(delta) || delta === 0 || delta < -600 || delta > 600) {
      return jsonResponse({ ok: false, error: "invalid delta" }, 400);
    }
    cmd.delta = delta;
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkResolveRateLimit(env, ip, "tv-command"))) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }
  try {
    await env.CACHE?.put(tvCommandKey(session), JSON.stringify(cmd), {
      expirationTtl: TV_COMMAND_TTL_SECONDS,
    });
  } catch {
    return jsonResponse({ ok: false, error: "try_again" }, 503);
  }
  return jsonResponse({ ok: true, id: cmd.id }, 200);
}

// GET /api/tv-command?session=XXXXXX -> { ok: true, command } or
// { ok: false, error: "no_command" }. No rate limit (see above); the TV
// dedupes by command id, so a stored command is only applied once.
async function handleApiTvCommandGet(request: Request, env: Env, url: URL): Promise<Response> {
  const session = url.searchParams.get("session") || "";
  if (!isValidTvSession(session)) {
    return jsonResponse({ ok: false, error: "invalid session" }, 400);
  }
  try {
    const raw = await env.CACHE?.get(tvCommandKey(session));
    if (!raw) return jsonResponse({ ok: false, error: "no_command" }, 200);
    return jsonResponse({ ok: true, command: JSON.parse(raw) }, 200);
  } catch {
    return jsonResponse({ ok: false, error: "no_command" }, 200);
  }
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
  // EmbedWave is the only embed fallback: it plays inside a sandboxed
  // iframe (popups/redirects blocked). The old vidlink fallback was
  // removed — it is unsandboxed and its popups could not be blocked.
  const embedwave = embedwaveUrl(type, id, seasonNum, episodeNum);
  const embedwaveServer = {
    name: "embedwave",
    qualities: [{ quality: "HD", stream: embedwave }],
  };

  const resolved = await resolveServersByTmdb(env, type, id, seasonNum, episodeNum);
  if (!resolved) {
    // No validated native stream: top-level ok stays false (existing
    // behaviour) so the frontend falls back to the embed player, and the
    // embedwave server is still listed.
    return jsonResponse({ ok: false, servers: [embedwaveServer] }, 404);
  }

  // Sign one stream/download token per quality (tokens live 3h).
  // Expose raw `direct` URL on CORS-open CDN hosts (downet.net) so browsers can
  // stream ranges directly without burning Worker subrequest quota, while keeping
  // signed /stream?t=... as automatic fallback and dl=1 download filename carrier.
  const servers: Array<{
    name: string;
    qualities: Array<{ quality: string; stream: string; direct?: string; download?: string; size?: string }>;
  }> = [];
  for (const server of resolved.servers) {
    const qualities: Array<{ quality: string; stream: string; direct?: string; download?: string; size?: string }> = [];
    for (const q of server.qualities) {
      const token = await signToken(
        {
          u: q.directVideoUrl,
          // The download file name: "Title" for movies, "Title S01E01"
          // for episodes — the /stream proxy turns this into the
          // Content-Disposition filename, which is what the browser
          // actually saves (the anchor's `download` attribute is ignored
          // cross-origin, so a bare title here made every episode of a
          // season download as the same "VisionQuest.mp4").
          n: downloadDisplayName(resolved.title, seasonNum, episodeNum),
          k: "mp4",
          e: Math.floor(Date.now() / 1000) + 3 * 3600,
        },
        env.SIGNING_SECRET,
      );
      const stream = `${publicBase}/stream?t=${encodeURIComponent(token)}`;
      qualities.push({
        quality: q.quality,
        stream,
        ...(isCorsDirectCdn(q.directVideoUrl) ? { direct: q.directVideoUrl } : {}),
        download: `${stream}&dl=1`,
        ...(q.size ? { size: q.size } : {}),
      });
    }
    servers.push({ name: server.name, qualities });
  }
  servers.push(embedwaveServer);

  // Top-level fields stay the default: best quality of the first server.
  const best = servers[0].qualities[0];
  return jsonResponse(
    {
      ok: true,
      title: resolved.title,
      quality: best.quality,
      stream: best.stream,
      ...(best.direct ? { direct: best.direct } : {}),
      download: best.download,
      servers,
    },
    200,
  );
}

function isCorsDirectCdn(url: string): boolean {
  return url.includes("downet.net");
}
