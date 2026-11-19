import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";

const BASE = "https://filmaty.hudhaifa-bio.workers.dev";
const SECRET = "test-secret-key-at-least-32-characters-long";

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

function callWorker(path: string, env: any, headers?: Record<string, string>): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, headers ? { headers } : undefined), env, {} as any);
}

const sampleMovies = [
  { id: 1001, title: "Action Sample", vote_average: 7.9, popularity: 120, poster_path: "/a1.jpg" },
  { id: 1002, title: "Sci-Fi Sample", vote_average: 8.2, popularity: 110, poster_path: "/a2.jpg" },
];

function installBrowseMock() {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/discover/")) {
      if (!url.includes("language=en-US")) seen.push(url);
      return jsonResponse({ results: sampleMovies, total_pages: 10 });
    }
    return jsonResponse({ results: [] });
  };
  return {
    seen,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("GET /api/browse forwards genre=28 to TMDB with_genres and rejects invalid genre", async () => {
  const { seen, restore } = installBrowseMock();
  const { env } = mockEnv();
  try {
    const res = await callWorker("/api/browse?type=movie&genre=28&sort=popular&page=1", env);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].media_type, "movie");
    assert.equal(seen.length, 1);
    assert.match(seen[0], /\/discover\/movie\?/);
    assert.match(seen[0], /with_genres=28/);

    const bad = await callWorker("/api/browse?type=movie&genre=9999&sort=popular&page=1", env);
    assert.equal(bad.status, 400);
  } finally {
    restore();
  }
});

test("GET /api/browse supports sort=newest for movie and tv and rejects sort=latest", async () => {
  const { seen, restore } = installBrowseMock();
  const { env } = mockEnv();
  try {
    const mRes = await callWorker("/api/browse?type=movie&sort=newest&page=1", env);
    assert.equal(mRes.status, 200);
    assert.match(seen[0], /sort_by=primary_release_date\.desc/);
    assert.match(seen[0], /primary_release_date\.lte=/);
    assert.match(seen[0], /vote_count\.gte=20/);

    const tvRes = await callWorker("/api/browse?type=tv&sort=newest&page=1", env);
    assert.equal(tvRes.status, 200);
    assert.match(seen[1], /sort_by=first_air_date\.desc/);
    assert.match(seen[1], /first_air_date\.lte=/);
    assert.match(seen[1], /vote_count\.gte=20/);

    const bad = await callWorker("/api/browse?type=movie&sort=latest&page=1", env);
    assert.equal(bad.status, 400);
  } finally {
    restore();
  }
});

test("GET /api/browse passes year param properly and rejects out-of-range year", async () => {
  const { seen, restore } = installBrowseMock();
  const { env } = mockEnv();
  try {
    const mRes = await callWorker("/api/browse?type=movie&year=2025&page=1", env);
    assert.equal(mRes.status, 200);
    assert.match(seen[0], /primary_release_year=2025/);

    const tvRes = await callWorker("/api/browse?type=tv&year=2025&page=1", env);
    assert.equal(tvRes.status, 200);
    assert.match(seen[1], /first_air_date_year=2025/);

    const bad = await callWorker("/api/browse?type=movie&year=1800&page=1", env);
    assert.equal(bad.status, 400);
  } finally {
    restore();
  }
});

test("browse cache key distinguishes genre and year variants", async () => {
  const { seen, restore } = installBrowseMock();
  const { map, env } = mockEnv();
  try {
    await callWorker("/api/browse?type=movie&genre=28&page=1", env);
    await callWorker("/api/browse?type=movie&genre=35&page=1", env);
    await callWorker("/api/browse?type=movie&genre=28&year=2024&page=1", env);
    // Repeat exact first request -> served from cache.
    await callWorker("/api/browse?type=movie&genre=28&page=1", env);

    assert.equal(seen.length, 3);
    assert.ok(map.has("browse4:movie:all:popular:1:g:28"));
    assert.ok(map.has("browse4:movie:all:popular:1:g:35"));
    assert.ok(map.has("browse4:movie:all:popular:1:g:28:y:2024"));
  } finally {
    restore();
  }
});

test("/api/browse allows 45 requests from same IP while /api/resolve keeps 30/min bucket", async () => {
  const { restore } = installBrowseMock();
  const { env } = mockEnv();
  const headers = { "CF-Connecting-IP": "203.0.113.77" };
  try {
    for (let i = 1; i <= 45; i++) {
      const res = await callWorker(`/api/browse?type=movie&genre=28&page=${i}`, env, headers);
      assert.equal(res.status, 200, `Expected 200 on browse request ${i}`);
    }

    // Confirm /api/resolve has an isolated bucket of 30 requests per IP.
    for (let i = 1; i <= 30; i++) {
      const r = await callWorker("/api/resolve?type=movie&id=999999", env, headers);
      assert.notEqual(r.status, 429, `Resolve request ${i} should not hit rate limit`);
    }
    const r31 = await callWorker("/api/resolve?type=movie&id=999999", env, headers);
    assert.equal(r31.status, 429);

    // /api/browse still works after /api/resolve is rate-limited on the same IP.
    const browseAfter = await callWorker("/api/browse?type=movie&collection=netflix&page=1", env, headers);
    assert.equal(browseAfter.status, 200);
  } finally {
    restore();
  }
});

function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    if (m[2].trim()) scripts.push(m[2]);
  }
  return scripts;
}

test("index.html exposes expanded movie catalog controls and valid inline JS", () => {
  const html = readFileSync("index.html", "utf8");
  for (const needle of [
    'data-filter="netflix-movies"',
    'data-filter="newest-movies"',
    'data-filter="action-movies"',
    'id="drawerNetflixMovies"',
    'data-group="movie-genres"',
    'id="gridFilterBar"',
    "renderGridFilterBar",
    "fetchBrowseBatch",
    "IntersectionObserver",
  ]) {
    assert.ok(html.includes(needle), `Missing ${needle} in index.html`);
  }
  assert.ok(!html.includes("/discover/"), "index.html must not call TMDB /discover/ directly");
  assert.ok(!html.includes("loadDiscover"), "index.html must not contain loadDiscover");

  const scripts = extractInlineScripts(html);
  assert.ok(scripts.length > 0);
  for (const code of scripts) {
    new Function(code);
  }
});

test("Tv/index.html exposes TV movie tabs, pagination button, extra rows, and stays watch-only", () => {
  const tvHtml = readFileSync("Tv/index.html", "utf8");
  for (const needle of [
    'data-tab="netflix-movies"',
    'data-tab="netflix"',
    'data-tab="action-movies"',
    "TV_EXTRA_MOVIE_ROWS",
    "fetchTvBrowseBatch",
    'id="tvLoadMoreBtn"',
    "tv-focus",
  ]) {
    assert.ok(tvHtml.includes(needle), `Missing ${needle} in Tv/index.html`);
  }

  for (const forbidden of [
    "window.open",
    "vidlink",
    "navigator.userAgent",
    "location.replace",
    "location.href =",
    "bot-code",
    "downloadQuality",
    "downloadSeason",
    "btnDownloadSeason",
    'href="https://t.me',
    "serviceWorker",
  ]) {
    assert.ok(!tvHtml.includes(forbidden), `Tv/index.html must not contain ${forbidden}`);
  }

  const scripts = extractInlineScripts(tvHtml);
  assert.ok(scripts.length > 0);
  for (const code of scripts) {
    new Function(code);
  }
});
