import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { verifyToken } from "../src/engine/token.ts";
import { isTimeBoundDirectUrl, resolveCacheTtl } from "../src/engine/resolve.ts";

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
  const puts: Array<{ key: string; ttl?: number }> = [];
  return {
    map,
    puts,
    env: {
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: SECRET,
      TMDB_KEY: "test-tmdb-key",
      PUBLIC_BASE: BASE,
      CACHE: {
        get: async (k: string) => map.get(k) ?? null,
        put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
          map.set(k, v);
          puts.push({ key: k, ttl: opts?.expirationTtl });
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
  const { env, map, puts } = mockEnv();
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

    // Success is cached for 1h under srv11:<type>:<id>:<s>:<e> —
    // Akwam's downet links carry a fixed expiry timestamp in the path,
    // so they are time-bound like Laroza's okprimeone links: a 6h cache
    // kept serving a stale link and the player spun forever (Interstellar
    // loaded ~15 min and never opened on 2026-11-19). 1h is comfortably
    // below every link life and below the 3h /stream token life.
    const cached = map.get("srv11:movie:157336:0:0");
    assert.ok(cached, "expected cached resolve result");
    assert.equal(JSON.parse(cached!).ok, true);
    assert.equal(
      puts.find((p) => p.key === "srv11:movie:157336:0:0")?.ttl,
      1 * 3600,
      "Akwam resolves cache for 1h",
    );
  } finally {
    restore();
  }
});

test("resolveCacheTtl: 1h for time-bound provider links, 6h otherwise", () => {
  const larozaStyle = {
    title: "VisionQuest",
    servers: [
      {
        name: "لاروزا",
        qualities: [
          {
            quality: "720p HD",
            // Live Laroza shape (2026-11-19): hashed subdomain on
            // okprimeone.site, signed query (?t=&s=&e=7200&i=0.0) —
            // the link dies 2h after issue, so the resolve must cache
            // for 1h only.
            directVideoUrl:
              "https://b6gtc2dez8aqmb6gtc2dez8aqmb6gtc2dez8aqmb6gtc2dez8aqm.okprimeone.site/v/02/00029/tdwa5as7pnce_n/VisionQuest.S01E01.mp4?t=o6H50kKKLc6ixhPDX2_nVR-RWu20GoTB3naQqRQszjM&s=1795090421&e=7200&v=&sp=207&i=0.0",
          },
        ],
      },
    ],
  };
  assert.equal(resolveCacheTtl(larozaStyle as any), 1 * 3600, "Laroza resolves cache for 1h");
  assert.ok(
    isTimeBoundDirectUrl(larozaStyle.servers[0].qualities[0].directVideoUrl),
    "okprimeone.site links are time-bound",
  );

  const akwamStyle = {
    title: "Interstellar",
    servers: [
      {
        name: "أكوام",
        qualities: [
          {
            quality: "1080p FHD",
            // Live Akwam shape: downet links carry a fixed expiry
            // timestamp in the path (/download/<expiry>/<hash>/<file>).
            directVideoUrl:
              "https://s301d5.downet.net/download/1795176189/6afee57d3005d/Interstellar.2014.IMAX.1080p.Bluray.AKWAM.mp4",
          },
        ],
      },
    ],
  };
  assert.equal(resolveCacheTtl(akwamStyle as any), 1 * 3600, "Akwam resolves cache for 1h");
  assert.ok(
    isTimeBoundDirectUrl(akwamStyle.servers[0].qualities[0].directVideoUrl),
    "downet.net links are time-bound",
  );

  const genericStyle = {
    title: "Generic",
    servers: [
      {
        name: "Other CDN",
        qualities: [{ quality: "720p", directVideoUrl: "https://cdn.example.com/files/movie.mp4" }],
      },
    ],
  };
  assert.equal(resolveCacheTtl(genericStyle as any), 6 * 3600, "generic mp4 hosts keep the 6h TTL");
  assert.equal(
    resolveCacheTtl({ title: "Empty", servers: [] } as any),
    6 * 3600,
    "results with no qualities keep the 6h TTL",
  );
});

test("pre-fix srv9: entries are never reused (key bumped to srv11:)", async () => {
  const restore = installFetchMock();
  const { env, map, puts } = mockEnv();
  try {
    // A stale pre-fix entry: ok:true but a wrong title. If the resolver
    // read it, the response would say STALE.
    map.set(
      "srv9:movie:157336:0:0",
      JSON.stringify({
        ok: true,
        title: "STALE",
        servers: [
          {
            name: "stale",
            qualities: [{ quality: "720p", directVideoUrl: "https://cdn.example.com/stale.mp4" }],
          },
        ],
      }),
    );
    const res = await callResolve(env, "/api/resolve?type=movie&id=157336");
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.title, "Interstellar", "stale srv9 entry must be ignored");
    assert.ok(map.get("srv11:movie:157336:0:0"), "fresh resolve must cache under srv11:");
    assert.equal(
      puts.find((p) => p.key === "srv11:movie:157336:0:0")?.ttl,
      1 * 3600,
      "fresh Akwam resolve caches for 1h under srv11:",
    );
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
    const cached = map.get("srv11:movie:999999999:0:0");
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
