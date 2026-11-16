import test from "node:test";
import assert from "node:assert/strict";
import { signToken } from "../src/engine/token.ts";
import { handleStreamProxy } from "../src/engine/proxy.ts";
import {
  resolveByTmdb,
  titlesMatch,
  validateDirectUrl,
} from "../src/engine/resolve.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";
const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

// -----------------------------------------------------------------------------
// A. Proxy: an upstream error must never be served as an attachment download
// -----------------------------------------------------------------------------

async function tokenFor(): Promise<string> {
  return signToken(
    {
      u: "https://example.com/video.mp4",
      n: "Dexter",
      k: "mp4",
      e: Math.floor(Date.now() / 1000) + 3600,
    },
    SECRET,
  );
}

function installUpstreamMock(mode: "526" | "throws" | "404") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (mode === "throws") throw new Error("fetch failed");
    if (mode === "526") {
      return new Response("Cloudflare 526 error page", {
        status: 526,
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response("not found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

for (const mode of ["526", "throws", "404"] as const) {
  test(`proxy: upstream ${mode} with dl=1 returns an error with NO content-disposition`, async () => {
    const restore = installUpstreamMock(mode);
    try {
      const token = await tokenFor();
      const res = await handleStreamProxy(
        new Request(`https://worker.test/stream?t=${encodeURIComponent(token)}&dl=1`),
        SECRET,
      );
      // Never a 200, never an attachment: the browser must not save a
      // 16-byte error body as "Dexter.mp4".
      assert.notEqual(res.status, 200);
      assert.equal(res.headers.get("content-disposition"), null);
      const body = await res.text();
      assert.ok(body.length < 200, `error body should stay short, got ${body.length} chars`);
      if (mode === "526") assert.equal(res.status, 526);
      if (mode === "throws") assert.equal(res.status, 502);
      if (mode === "404") assert.equal(res.status, 404);
    } finally {
      restore();
    }
  });
}

// -----------------------------------------------------------------------------
// B. Resolver: Dexter S1E1 must never resolve to a Resurrection file
// -----------------------------------------------------------------------------

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

// Mocked network for the Dexter scenario. Akwam search returns, in order:
// "Dexter: Resurrection" (must be rejected by strict title matching),
// "Dexter" #111 (its direct link is dead — 526), "Dexter" #222 (valid).
// Every other provider returns an empty page -> no candidates.
function installDexterMock(opts: { deadB?: boolean } = {}) {
  const originalFetch = globalThis.fetch;

  const searchHtml = `
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/999/dexter-resurrection">Dexter: Resurrection</a></h3></div>
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/111/dexter">Dexter</a></h3></div>
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/222/dexter">Dexter</a></h3></div>
  `;
  const detailsHtml = (epId: number) => `
    <html><head><title>Dexter</title></head><body>
    <h1 class="entry-title">Dexter</h1>
    <a href="https://akwam.ss/episode/${epId}/dexter/1">الحلقة 1</a>
    </body></html>
  `;
  const episodeHtml = (watchId: number, itemId: number) => `
    <html><body>
    <a href="https://akwam.ss/watch/${watchId}/${itemId}/dexter-s1e1">مشاهدة</a>
    </body></html>
  `;
  const watchHtml = (directUrl: string) => `
    <html><body><video><source src="${directUrl}"></video></body></html>
  `;

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/tv/1405")) {
      return new Response(
        JSON.stringify({
          id: 1405,
          name: "Dexter",
          original_name: "Dexter",
          first_air_date: "2006-10-01",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("api.themoviedb.org")) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(searchHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/series/111")) {
      return new Response(detailsHtml(1001), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("akwam.ss/series/222")) {
      return new Response(detailsHtml(1002), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("akwam.ss/episode/1001")) {
      return new Response(episodeHtml(5001, 111), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("akwam.ss/episode/1002")) {
      return new Response(episodeHtml(5002, 222), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("akwam.ss/watch/5001")) {
      return new Response(
        watchHtml("https://dead.downet.net/download/1/dexter.resurrection.s02e01.mp4"),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("akwam.ss/watch/5002")) {
      return new Response(
        watchHtml("https://ok.downet.net/download/2/dexter.s01e01.1080p.mp4"),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    // Validation probes of the direct CDN links.
    if (url.includes("dead.downet.net")) {
      return new Response("Cloudflare 526 error page", {
        status: 526,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("ok.downet.net")) {
      if (opts.deadB) {
        return new Response("Cloudflare 526 error page", {
          status: 526,
          headers: { "Content-Type": "text/html" },
        });
      }
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

test("resolveByTmdb: Dexter S1E1 skips the dead candidate and the Resurrection show, returns the valid Dexter link", async () => {
  const restore = installDexterMock();
  const { env } = mockEnv();
  try {
    const result = await resolveByTmdb(env, "tv", 1405, 1, 1);
    assert.ok(result, "expected a resolved stream, got null");
    assert.equal(result!.title, "Dexter");
    assert.equal(
      result!.directVideoUrl,
      "https://ok.downet.net/download/2/dexter.s01e01.1080p.mp4",
    );
    assert.ok(
      !result!.directVideoUrl.toLowerCase().includes("resurrection"),
      `must not resolve to Resurrection: ${result!.directVideoUrl}`,
    );
  } finally {
    restore();
  }
});

test("resolveByTmdb: returns null when every candidate fails validation", async () => {
  const restore = installDexterMock({ deadB: true });
  const { env } = mockEnv();
  try {
    const result = await resolveByTmdb(env, "tv", 1405, 1, 1);
    assert.equal(result, null);
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// C. Strict title matching
// -----------------------------------------------------------------------------

test("titlesMatch: rejects spin-offs, accepts exact matches and season metadata", () => {
  assert.equal(titlesMatch("Dexter: Resurrection", "Dexter"), false);
  assert.equal(titlesMatch("Dexter: New Blood", "Dexter"), false);
  assert.equal(titlesMatch("Dexter", "Dexter"), true);
  assert.equal(titlesMatch("Dexter (2006)", "Dexter"), true);
  assert.equal(titlesMatch("Dexter (الموسم 1)", "Dexter"), true);
  assert.equal(titlesMatch("Dexter Season 2", "Dexter"), true);
  assert.equal(titlesMatch("Breaking Bad", "Breaking Bad"), true);
  assert.equal(titlesMatch("Breaking Bad", "Dexter"), false);
  assert.equal(titlesMatch("The Last of Us", "Last of Us"), true);
});

// -----------------------------------------------------------------------------
// D. Direct-URL validation
// -----------------------------------------------------------------------------

test("validateDirectUrl: 206 video/mp4 passes, 526 / HTML error page / throw fail", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("good")) {
        return new Response("x", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Length": "1" },
        });
      }
      if (url.includes("octet")) {
        return new Response("x", {
          status: 200,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": "1" },
        });
      }
      if (url.includes("html-error")) {
        return new Response("<html>error</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.includes("boom")) throw new Error("fetch failed");
      return new Response("err", { status: 526, headers: { "Content-Type": "text/html" } });
    };
    assert.equal(await validateDirectUrl("https://cdn.test/good.mp4"), true);
    assert.equal(await validateDirectUrl("https://cdn.test/octet.mp4"), true);
    assert.equal(await validateDirectUrl("https://cdn.test/html-error.mp4"), false);
    assert.equal(await validateDirectUrl("https://cdn.test/boom.mp4"), false);
    assert.equal(await validateDirectUrl("https://cdn.test/dead.mp4"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
