import { hostOf } from "./normalize.ts";
import { edgeGet, edgePut } from "./edge-cache.ts";

export interface ProbeResult {
  url: string;
  playable: boolean;
  kind: "mp4" | "hls" | "embed";
  status: number;
  contentType: string;
  contentLength: number;
  sizeFormatted?: string;
  acceptRanges: boolean;
  latencyMs: number;
  score: number;
  serverTag: string;
  host: string;
  referer?: string;
}

export async function probeLink(
  url: string,
  referer?: string,
  timeoutMs = 3500,
): Promise<ProbeResult> {
  const host = hostOf(url);
  const started = Date.now();

  // If it's a known embed player page (e.g., dood, uqload, mixdrop, voe)
  const isExplicitEmbed = isEmbedHost(host);

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Range: "bytes=0-1024",
  };
  if (referer) {
    headers["Referer"] = referer;
    try {
      headers["Origin"] = new URL(referer).origin;
    } catch {}
  }

  try {
    let res = await fetch(url, {
      method: isExplicitEmbed ? "HEAD" : "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });

    const latencyMs = Date.now() - started;
    const status = res.status;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const acceptRanges = (res.headers.get("accept-ranges") || "").toLowerCase().includes("bytes");
    const rawLen = res.headers.get("content-range") || res.headers.get("content-length") || "0";
    const contentLength = parseContentLength(rawLen);

    // Cancel body stream quickly
    if (res.body) {
      try {
        await res.body.cancel();
      } catch {}
    }

    const isOk = status >= 200 && status < 300;
    const isMp4 = contentType.includes("video") || url.includes(".mp4");
    const isHls =
      contentType.includes("mpegurl") || contentType.includes("m3u8") || url.includes(".m3u8");

    let kind: "mp4" | "hls" | "embed" = "embed";
    if (isMp4) kind = "mp4";
    else if (isHls) kind = "hls";

    let score = 0;
    let playable = false;

    if (isOk) {
      playable = true;
      score += 40;
      if (isMp4) score += 50;
      if (isHls) score += 45;
      if (acceptRanges) score += 15;
      if (latencyMs < 300) score += 30;
      else if (latencyMs < 700) score += 20;
      else if (latencyMs < 1200) score += 10;
    } else if (isExplicitEmbed && (status === 200 || status === 403 || status === 405)) {
      // Some video embed hosts reject HEAD/range but work inside iframe
      playable = true;
      score = 35;
      kind = "embed";
    }

    let serverTag = "🟡 سيرفر بديل";
    if (score >= 90) serverTag = "⚡️ الأسرع ومباشر";
    else if (score >= 70) serverTag = "🟢 سيرفر مباشر";
    else if (!playable) serverTag = "❌ غير متاح";

    return {
      url,
      playable,
      kind,
      status,
      contentType,
      contentLength,
      sizeFormatted: formatBytes(contentLength),
      acceptRanges,
      latencyMs,
      score,
      serverTag,
      host,
      referer,
    };
  } catch {
    const latencyMs = Date.now() - started;
    // Fallback for known embed hosts
    if (isExplicitEmbed) {
      return {
        url,
        playable: true,
        kind: "embed",
        status: 200,
        contentType: "text/html",
        contentLength: 0,
        acceptRanges: false,
        latencyMs,
        score: 30,
        serverTag: "🟡 سيرفر خارجي",
        host,
        referer,
      };
    }
    return {
      url,
      playable: false,
      kind: "embed",
      status: 0,
      contentType: "",
      contentLength: 0,
      acceptRanges: false,
      latencyMs,
      score: 0,
      serverTag: "❌ غير متاح",
      host,
      referer,
    };
  }
}

export async function probeCached(
  url: string,
  referer: string | undefined,
  kv?: KVNamespace,
): Promise<ProbeResult> {
  const cacheKey = `probe:${url}`;
  // Edge cache (Cache API, no write quota); kv is only read/written as a
  // fallback in runtimes without caches.default (tests).
  const cached = await edgeGet(cacheKey, kv);
  if (cached) {
    try {
      return JSON.parse(cached) as ProbeResult;
    } catch {}
  }

  const result = await probeLink(url, referer);

  if (result.playable) {
    await edgePut(cacheKey, JSON.stringify(result), 1800, kv); // 30 min cache
  }

  return result;
}

function parseContentLength(headerVal: string): number {
  if (headerVal.includes("/")) {
    const total = headerVal.split("/")[1];
    const n = Number(total);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const n = Number(headerVal);
  return Number.isNaN(n) ? 0 : n;
}

export function formatBytes(bytes: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function isEmbedHost(host: string): boolean {
  return /streamwish|uqload|vidmoly|dood|mixdrop|voe|dsvplay|vk\.com|abstream|filelions|mp4plus|vidoba|vidspeed|okhd/i.test(
    host,
  );
}
