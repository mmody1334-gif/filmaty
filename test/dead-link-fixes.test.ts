import test from "node:test";
import assert from "node:assert/strict";
import { signToken } from "../src/engine/token.ts";
import { handleStreamProxy } from "../src/engine/proxy.ts";
import {
  resolveByTmdb,
  titlesMatch,
  validateDirectUrl,
} from "../src/engine/resolve.ts";
import { LarozaProvider } from "../src/providers/laroza.ts";

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
    <a href="https://akwam.ss/episode/${epId}/dexter">حلقة 1 : مسلسل Dexter الموسم الاول</a>
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
  // Arabic ordinal-word season suffixes (the form Akwam titles use):
  // the season part is metadata, the show still matches.
  assert.equal(titlesMatch("Dexter الموسم الاول (الموسم 1)", "Dexter"), true);
  assert.equal(titlesMatch("Dexter الموسم الثاني", "Dexter"), true);
  // ...but a spin-off stays a different show even with a season suffix.
  assert.equal(titlesMatch("Dexter: Resurrection الموسم الثاني (الموسم 2)", "Dexter"), false);
  assert.equal(titlesMatch("Dexter: Resurrection الموسم الاول", "Dexter"), false);
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

// -----------------------------------------------------------------------------
// E. Resolver: a season-2 page listed first must not resolve as season 1
// (live Akwam titles carry the season as an Arabic ordinal word, and the
// details parser used to label every page's episodes as season 1)
// -----------------------------------------------------------------------------

function installDexterSeasonsMock() {
  const originalFetch = globalThis.fetch;
  const searchHtml = `
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/301/dexter-s2">Dexter الموسم الثاني</a></h3></div>
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/302/dexter-s1">Dexter الموسم الاول</a></h3></div>
  `;
  const detailsHtml = (epId: number, seasonWord: string) => `
    <html><head><title>Dexter</title></head><body>
    <h1 class="entry-title">Dexter</h1>
    <a href="https://akwam.ss/episode/${epId}/dexter">حلقة 1 : مسلسل Dexter الموسم ${seasonWord}</a>
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
        JSON.stringify({ id: 1405, name: "Dexter", original_name: "Dexter", first_air_date: "2006-10-01" }),
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
    if (url.includes("akwam.ss/series/301")) {
      return new Response(detailsHtml(3001, "الثاني"), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/series/302")) {
      return new Response(detailsHtml(3002, "الاول"), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/episode/3001")) {
      return new Response(episodeHtml(6001, 301), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/episode/3002")) {
      return new Response(episodeHtml(6002, 302), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/watch/6001")) {
      return new Response(watchHtml("https://ok.downet.net/download/3/dexter.s02e01.720p.mp4"), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/watch/6002")) {
      return new Response(watchHtml("https://ok.downet.net/download/4/dexter.s01e01.720p.mp4"), { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("ok.downet.net")) {
      return new Response("x", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/100", "Content-Length": "1" },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("resolveByTmdb: Dexter S1E1 skips the season-2 page listed first and returns the season-1 file", async () => {
  const restore = installDexterSeasonsMock();
  const { env } = mockEnv();
  try {
    const result = await resolveByTmdb(env, "tv", 1405, 1, 1);
    assert.ok(result, "expected a resolved stream, got null");
    assert.equal(
      result!.directVideoUrl,
      "https://ok.downet.net/download/4/dexter.s01e01.720p.mp4",
    );
  } finally {
    restore();
  }
});

// -----------------------------------------------------------------------------
// F. Laroza: a bare-title video page must not default to episode 1
// (a real Laroza page titled "Dexter" once resolved to episode 4's file)
// -----------------------------------------------------------------------------

test("Laroza getDetails: video page whose <title> says episode 4 reports episode 4, not 1", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<html><head><title>مسلسل Dexter الموسم الاول الحلقة 4 مترجمة</title></head><body><h1>Dexter</h1></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  try {
    const provider = new LarozaProvider();
    const details = await provider.getDetails({
      id: "laroza:383c220e9",
      title: "Dexter",
      kind: "series",
      site: "laroza",
      url: "https://laroza1.cfd/video.php?vid=383c220e9",
    } as any);
    assert.equal(details.seasons.length, 1);
    assert.equal(details.seasons[0].episodes[0].episode, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function installLarozaEp4Mock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/tv/1405")) {
      return new Response(
        JSON.stringify({ id: 1405, name: "Dexter", original_name: "Dexter", first_air_date: "2006-10-01" }),
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
      return new Response(
        `<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/999/dexter-resurrection">Dexter: Resurrection</a></h3></div>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("laroza1.quest/search.php")) {
      return new Response(
        `<a href="https://laroza1.cfd/video.php?vid=383c220e9" title="مسلسل Dexter الموسم الاول">مسلسل Dexter الموسم الاول</a>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("laroza1.cfd/video.php")) {
      return new Response(
        `<html><head><title>مسلسل Dexter الموسم الاول الحلقة 4 مترجمة</title></head><body></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("resolveByTmdb: a Laroza video page that is really episode 4 never resolves as episode 1", async () => {
  const restore = installLarozaEp4Mock();
  const { env } = mockEnv();
  try {
    const result = await resolveByTmdb(env, "tv", 1405, 1, 1);
    assert.equal(result, null);
  } finally {
    restore();
  }
});
