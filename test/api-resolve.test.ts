import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { verifyToken } from "../src/engine/token.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";
const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockEnv() {
  const map = new Map<string, string>();
  return {
    map,
    env: {
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: SECRET,
      TMDB_KEY: "test-tmdb-key",
      PUBLIC_BASE: BASE,
      CACHE: {
        get: async (k: string) => map.get(k) ?? null,
        put: async (k: string, v: string) => {
          map.set(k, v);
        },
        delete: async (k: string) => {
          map.delete(k);
        },
      },
    } as any,
  };
}

// Mocked network: TMDB knows Interstellar (157336) and nothing else; the
// embed provider is pure (no network) and returns a candidate for it; the
// Akwam resolver finds a direct mp4 in the mocked vidsrc page; every other
// provider site returns an empty page -> no candidates. Hermetic: no live net.
function installFetchMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/movie/157336")) {
      return jsonResponse({
        id: 157336,
        title: "Interstellar",
        original_title: "Interstellar",
        release_date: "2014-11-05",
      });
    }
    if (url.includes("api.themoviedb.org/3/movie/")) {
      return new Response(JSON.stringify({ status_message: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("vidsrc.to") || url.includes("vidsrc.me") || url.includes("streamwish.to")) {
      return new Response(
        '<html><body><video><source src="https://s204d1.downet.net/download/123/Interstellar.720p.mp4"></video></body></html>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    // The resolver validates a direct URL with a Range probe before
    // returning it: a healthy CDN answers 206 with a video content-type.
    if (url.includes("downet.net")) {
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/441957985",
          "Content-Length": "1",
        },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function callResolve(env: any, path: string, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, { headers }), env, {} as any);
}

test("OPTIONS /api/resolve returns 204 with CORS headers", async () => {
  const { env } = mockEnv();
  const res = await worker.fetch(
    new Request(`${BASE}/api/resolve?type=movie&id=157336`, { method: "OPTIONS" }),
    env,
    {} as any,
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok((res.headers.get("access-control-allow-methods") || "").includes("GET"));
});

test("validation: bad type returns 400, non-numeric id returns 400", async () => {
  const { env } = mockEnv();
  const badType = await callResolve(env, "/api/resolve?type=bad&id=157336");
  assert.equal(badType.status, 400);
  assert.equal((await badType.json() as any).ok, false);
  assert.equal(badType.headers.get("access-control-allow-origin"), "*");

  const badId = await callResolve(env, "/api/resolve?type=movie&id=abc");
  assert.equal(badId.status, 400);
  assert.equal((await badId.json() as any).ok, false);

  const missingId = await callResolve(env, "/api/resolve?type=movie");
  assert.equal(missingId.status, 400);
});

test("resolves Interstellar to a signed stream + download link", async () => {
  const restore = installFetchMock();
  const { env, map } = mockEnv();
  try {
    const res = await callResolve(env, "/api/resolve?type=movie&id=157336");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.title, "Interstellar");
    assert.ok(body.quality, "expected a quality string");
    assert.ok(body.stream.startsWith(`${BASE}/stream?t=`), `unexpected stream: ${body.stream}`);
    assert.ok(body.download.startsWith(`${BASE}/stream?t=`), `unexpected download: ${body.download}`);
    assert.ok(body.download.endsWith("&dl=1"), `download link must end with &dl=1: ${body.download}`);

    // The token in the stream link verifies and points at the direct mp4.
    const token = new URL(body.stream).searchParams.get("t")!;
    const payload = await verifyToken(token, SECRET);
    assert.ok(payload);
    assert.equal(payload!.u, "https://s204d1.downet.net/download/123/Interstellar.720p.mp4");
    assert.equal(payload!.k, "mp4");
    assert.equal(payload!.n, "Interstellar");

    // Success is cached for 6h under dl:<type>:<id>:<s>:<e>.
    const cached = map.get("dl:movie:157336:0:0");
    assert.ok(cached, "expected cached resolve result");
    assert.equal(JSON.parse(cached!).ok, true);
  } finally {
    restore();
  }
});

test("unknown TMDB id returns {ok:false} with 404 (not 500)", async () => {
  const restore = installFetchMock();
  const { env, map } = mockEnv();
  try {
    const res = await callResolve(env, "/api/resolve?type=movie&id=999999999");
    assert.equal(res.status, 404);
    assert.equal((await res.json() as any).ok, false);
    // Failures are cached too (30 min) so the lookup is not repeated.
    const cached = map.get("dl:movie:999999999:0:0");
    assert.ok(cached, "expected cached failure");
    assert.equal(JSON.parse(cached!).ok, false);
  } finally {
    restore();
  }
});

test("rate limit: 30 requests allowed per IP, the 31st gets 429", async () => {
  const restore = installFetchMock();
  const { env } = mockEnv();
  try {
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await callResolve(env, "/api/resolve?type=movie&id=157336", {
        "cf-connecting-ip": "203.0.113.7",
      });
      lastStatus = res.status;
      if (i < 30) {
        assert.equal(res.status, 200, `request ${i + 1} should pass`);
      }
      // Drain the body so the response is fully consumed.
      await res.text();
    }
    assert.equal(lastStatus, 429);
  } finally {
    restore();
  }
});
