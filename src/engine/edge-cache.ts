// Edge cache for short-lived, re-fetchable data (API responses, resolve
// results, subtitle indexes, OG metadata). Uses the Workers Cache API
// (caches.default), which has no write quota, instead of Workers KV whose
// free tier allows only 1,000 put operations/day. Traffic-driven cache
// rewrites kept exceeding that cap (Cloudflare KV alerts 2026-11-20/21/22),
// so every cache that can simply be re-fetched lives here; KV stays only
// for state that must survive everywhere (sessions, view counters, TV
// pairing).
//
// Entries carry their own expiry timestamp in a header: cache.match does
// not guarantee freshness checks in every colo, so expired entries are
// treated as misses and overwritten by the next put.
//
// The optional kv argument is a fallback for runtimes without the Cache
// API (local tests), where the mocked KV namespace verifies caching
// semantics. In production caches.default always exists, so KV is never
// written from here.

const CACHE_BASE = "https://filmaty-edge-cache.internal/";
const EXP_HEADER = "x-filmaty-exp";

function cacheRequest(key: string): Request {
  return new Request(CACHE_BASE + encodeURIComponent(key), { method: "GET" });
}

function edgeStore(): Cache | undefined {
  return (globalThis as { caches?: CacheStorage }).caches?.default;
}

export async function edgeGet(key: string, kv?: KVNamespace): Promise<string | null> {
  const store = edgeStore();
  if (store) {
    try {
      const res = await store.match(cacheRequest(key));
      if (!res) return null;
      const exp = Number(res.headers.get(EXP_HEADER) || "0");
      if (!exp || Date.now() > exp) return null;
      return await res.text();
    } catch {
      return null;
    }
  }
  if (kv) {
    try {
      return await kv.get(key);
    } catch {
      return null;
    }
  }
  return null;
}

export async function edgePut(
  key: string,
  value: string,
  ttlSeconds: number,
  kv?: KVNamespace,
): Promise<void> {
  const ttl = Math.max(60, Math.floor(ttlSeconds));
  const store = edgeStore();
  if (store) {
    try {
      const res = new Response(value, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `max-age=${ttl}`,
          [EXP_HEADER]: String(Date.now() + ttl * 1000),
        },
      });
      await store.put(cacheRequest(key), res);
    } catch {
      /* edge cache write failure: ignore */
    }
    return;
  }
  if (kv) {
    try {
      await kv.put(key, value, { expirationTtl: ttl });
    } catch {
      /* fallback write failure: ignore */
    }
  }
}
