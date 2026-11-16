import type { Env } from "./env.ts";
import { handleStreamProxy } from "./engine/proxy.ts";
import { resolveByTmdb } from "./engine/resolve.ts";
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
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "*",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

// Simple KV rate limit for /api/resolve: max 30 requests per IP per 10 min.
// Fails open (allows the request) if KV is unavailable.
async function checkResolveRateLimit(env: Env, ip: string): Promise<boolean> {
  try {
    if (!env.CACHE) return true;
    const key = `rl:resolve:${ip}`;
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

  const resolved = await resolveByTmdb(
    env,
    type,
    id,
    season !== undefined && Number.isInteger(season) && season > 0 ? season : undefined,
    episode !== undefined && Number.isInteger(episode) && episode > 0 ? episode : undefined,
  );
  if (!resolved) {
    return jsonResponse({ ok: false }, 404);
  }

  const publicBase = env.PUBLIC_BASE || url.origin;
  const token = await signToken(
    {
      u: resolved.directVideoUrl,
      n: resolved.title,
      k: "mp4",
      e: Math.floor(Date.now() / 1000) + 3 * 3600,
    },
    env.SIGNING_SECRET,
  );
  const stream = `${publicBase}/stream?t=${encodeURIComponent(token)}`;
  return jsonResponse(
    {
      ok: true,
      title: resolved.title,
      quality: resolved.quality,
      stream,
      download: `${stream}&dl=1`,
    },
    200,
  );
}
