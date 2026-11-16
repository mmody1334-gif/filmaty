import type { Env } from "./env.ts";
import { handleStreamProxy } from "./engine/proxy.ts";
import { verifyToken } from "./engine/token.ts";
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
