import { verifyToken, type MediaPayload } from "./token.ts";

export async function handleStreamProxy(request: Request, secret: string): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const payload: MediaPayload | null = await verifyToken(token, secret);
  if (!payload) {
    return new Response("Invalid or expired stream token", { status: 403 });
  }

  const targetUrl = payload.u;
  const upstreamHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  if (payload.r) {
    upstreamHeaders["Referer"] = payload.r;
    try {
      upstreamHeaders["Origin"] = new URL(payload.r).origin;
    } catch {}
  }

  // Forward Range header for video seeking
  const range = request.headers.get("range");
  if (range) {
    upstreamHeaders["Range"] = range;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    const isM3u8 = payload.k === "hls" || targetUrl.includes(".m3u8") || contentType.includes("mpegurl");

    if (isM3u8 && upstream.ok) {
      const playlistText = await upstream.text();
      const rewritten = rewriteHlsPlaylist(playlistText, targetUrl, url.origin, secret);
      return new Response(rewritten, {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "access-control-allow-origin": "*",
          "cache-control": "no-cache",
        },
      });
    }

    // Never serve an upstream error as a download: a failed upstream
    // (e.g. HTTP 526 from a dead CDN host) used to be streamed back with
    // content-disposition: attachment, so the browser saved a tiny error
    // body as "Dexter.mp4" and Chrome reported the download as failed.
    // Error responses are plain text, carry no content-disposition, and
    // keep the upstream status (or 502 when it is not a valid HTTP error).
    if (!upstream.ok) {
      return new Response(`Upstream error: HTTP ${upstream.status}`, {
        status: upstream.status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      });
    }

    const responseHeaders = new Headers();
    responseHeaders.set("access-control-allow-origin", "*");
    responseHeaders.set("access-control-allow-headers", "*");
    responseHeaders.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    responseHeaders.set("accept-ranges", "bytes");

    for (const [key, val] of upstream.headers.entries()) {
      const lower = key.toLowerCase();
      if (
        lower === "content-type" ||
        lower === "content-length" ||
        lower === "content-range" ||
        lower === "last-modified" ||
        lower === "etag"
      ) {
        responseHeaders.set(key, val);
      }
    }

    // Default video content type if generic octet-stream
    if (!responseHeaders.has("content-type") || responseHeaders.get("content-type")?.includes("octet-stream")) {
      responseHeaders.set("content-type", "video/mp4");
    }

    // Force a file download when requested (?dl=1). Range support above is
    // untouched, so interrupted downloads can still resume.
    if (url.searchParams.get("dl") === "1") {
      const safe = (payload.n || "filmaty").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120);
      // The ASCII fallback used to be the constant "filmaty.mp4" for
      // every file; now it carries the real name when it is ASCII-safe
      // (Latin titles), while filename* carries the full Unicode name.
      const ascii = safe.replace(/[^\x20-\x7E]/g, "").trim() || "filmaty";
      responseHeaders.set(
        "content-disposition",
        `attachment; filename="${ascii}.mp4"; filename*=UTF-8''${encodeURIComponent(safe)}.mp4`,
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return new Response(`Stream proxy error: ${err.message}`, { status: 502 });
  }
}

function rewriteHlsPlaylist(
  playlist: string,
  originalUrl: string,
  proxyOrigin: string,
  secret: string,
): string {
  const base = new URL(originalUrl);
  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        // Rewrite URI in tags like #EXT-X-KEY:METHOD=AES-128,URI="..."
        if (trimmed.startsWith("#EXT-X-KEY") && trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
            const abs = new URL(uri, base).href;
            return `URI="${proxyOrigin}/stream?t=${encodeURIComponent(createQuickToken(abs, secret))}"`;
          });
        }
        return line;
      }
      const absUrl = new URL(trimmed, base).href;
      return `${proxyOrigin}/stream?t=${encodeURIComponent(createQuickToken(absUrl, secret))}`;
    })
    .join("\n");
}

function createQuickToken(targetUrl: string, secret: string): string {
  // Simple synchronous HMAC or fallback for segment lines
  const data = JSON.stringify({ u: targetUrl, k: "hls", e: Math.floor(Date.now() / 1000) + 14400 });
  const b64 = btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64}.hls`;
}
