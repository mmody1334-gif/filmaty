import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";
import { BROWSE_COLLECTIONS } from "../src/engine/browse.ts";

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

function callWorker(path: string, env: any): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`), env, {} as any);
}

test("all 18 Arab and global BROWSE_COLLECTIONS resolve valid TMDB queries for movies and TV", async () => {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/discover/")) {
      if (!url.includes("language=en-US")) seen.push(url);
      return jsonResponse({ results: [{ id: 1, title: "Sample" }], total_pages: 3 });
    }
    return jsonResponse({ results: [] });
  };
  const { env } = mockEnv();
  try {
    assert.equal(BROWSE_COLLECTIONS.length, 18);
    for (const col of BROWSE_COLLECTIONS) {
      const mRes = await callWorker(`/api/browse?type=movie&collection=${col}&page=1`, env);
      assert.equal(mRes.status, 200, `movie collection=${col} expected 200`);
      const tRes = await callWorker(`/api/browse?type=tv&collection=${col}&page=1`, env);
      assert.equal(tRes.status, 200, `tv collection=${col} expected 200`);
    }

    const q = (idx: number) => seen[idx] || "";
    const hasPair = (colIdx: number, movieRe: RegExp, tvRe: RegExp) => {
      assert.match(q(colIdx * 2), movieRe);
      assert.match(q(colIdx * 2 + 1), tvRe);
    };

    const idxOf = (c: (typeof BROWSE_COLLECTIONS)[number]) => BROWSE_COLLECTIONS.indexOf(c);
    hasPair(idxOf("shahid"), /with_watch_providers=1715.*watch_region=EG|watch_region=EG.*with_watch_providers=1715/, /with_watch_providers=1715/);
    hasPair(idxOf("watchit"), /with_companies=137350/, /with_networks=4786/);
    hasPair(idxOf("yango"), /with_original_language=ar.*with_origin_country=EG|with_origin_country=EG.*with_original_language=ar/, /with_networks=7736/);
    hasPair(idxOf("osn"), /with_watch_providers=629.*watch_region=EG|watch_region=EG.*with_watch_providers=629/, /with_watch_providers=629/);
    hasPair(idxOf("showtime"), /with_companies=148935/, /with_networks=67/);
    hasPair(idxOf("starzplay"), /with_watch_providers=630.*watch_region=EG|watch_region=EG.*with_watch_providers=630/, /with_watch_providers=630/);
    hasPair(idxOf("tod"), /with_watch_providers=1750.*watch_region=EG|watch_region=EG.*with_watch_providers=1750/, /with_watch_providers=1750/);
    hasPair(idxOf("disney"), /with_watch_providers=337.*watch_region=US|watch_region=US.*with_watch_providers=337/, /with_watch_providers=337/);
    hasPair(idxOf("prime"), /with_watch_providers=9.*watch_region=US|watch_region=US.*with_watch_providers=9/, /with_watch_providers=9/);
    hasPair(idxOf("apple"), /with_watch_providers=350/, /with_watch_providers=350/);
    hasPair(idxOf("hbo"), /with_watch_providers=1899/, /with_watch_providers=1899/);
    hasPair(idxOf("paramount"), /with_watch_providers=531%7C2303|with_watch_providers=531\|2303/, /with_watch_providers=531/);
    hasPair(idxOf("hulu"), /with_watch_providers=15/, /with_watch_providers=15/);
    hasPair(idxOf("peacock"), /with_watch_providers=386/, /with_watch_providers=386/);
    hasPair(idxOf("crunchyroll"), /with_watch_providers=283/, /with_watch_providers=283/);
    hasPair(idxOf("dc"), /with_companies=429/, /with_companies=429/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/tmdb proxies allowlisted TMDB paths with KV caching and rejects invalid paths", async () => {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    seen.push(url);
    return jsonResponse({ results: [{ id: 55, title: "Upcoming Sample" }] });
  };
  const { map, env } = mockEnv();
  try {
    const r1 = await callWorker("/api/tmdb?path=%2Fmovie%2Fupcoming&lang=ar", env);
    assert.equal(r1.status, 200);
    const j1 = (await r1.json()) as any;
    assert.equal(j1.results[0].id, 55);
    assert.equal(seen.length, 1);
    assert.ok(map.has("tmdb1:/movie/upcoming:ar:"));

    // Second identical call comes from KV cache.
    const r2 = await callWorker("/api/tmdb?path=%2Fmovie%2Fupcoming&lang=ar", env);
    assert.equal(r2.status, 200);
    assert.equal(seen.length, 1);

    const det = await callWorker("/api/tmdb?path=%2Fmovie%2F157336&lang=ar&append=translations", env);
    assert.equal(det.status, 200);
    assert.match(seen[1], /\/movie\/157336\?api_key=test-tmdb-key&language=ar&append_to_response=translations/);

    for (const badQs of [
      "path=%2Fdiscover%2Fmovie",
      "path=%2Fconfiguration",
      "path=%2Fmovie%2F157336&lang=fr",
      "path=%2Fmovie%2Fupcoming&append=translations",
      "path=%2Fmovie%2F157336&append=credits",
    ]) {
      const bad = await callWorker(`/api/tmdb?${badQs}`, env);
      assert.equal(bad.status, 400, `expected 400 for ${badQs}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /sw.js and /manifest.json serve valid Worker PWA responses", async () => {
  const { env } = mockEnv();
  const swRes = await callWorker("/sw.js", env);
  assert.equal(swRes.status, 200);
  assert.match(swRes.headers.get("content-type") || "", /javascript/);
  const swText = await swRes.text();
  assert.ok(swText.includes("filmaty-shell-v1"));

  const mfRes = await callWorker("/manifest.json", env);
  assert.equal(mfRes.status, 200);
  const mf = (await mfRes.json()) as any;
  assert.equal(mf.name, "فيلماتي");
});

test("GET /api/resolve omits all 6 backup embeds for imdb_id:null stubs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/movie/888888")) {
      return jsonResponse({ id: 888888, title: "Stub Movie", imdb_id: null });
    }
    return jsonResponse({ results: [] });
  };
  const { env } = mockEnv();
  try {
    const res = await callWorker("/api/resolve?type=movie&id=888888", env);
    assert.equal(res.status, 404);
    const body = (await res.json()) as any;
    assert.deepEqual(body.servers, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("index.html includes year filter, type toggle, Arab platforms, back hook, and SW", () => {
  const html = readFileSync("index.html", "utf8");
  for (const s of [
    "GRID_YEARS",
    "data-grid-year",
    "data-grid-type",
    'data-collection="shahid"',
    'data-collection="watchit"',
    'data-collection="yango"',
    'data-collection="osn"',
    'data-collection="disney"',
    "__filmatyHandleBack",
    "btnNextBackupServer",
    "buildClientEmbedFallbacks",
    "fetchTmdbJson",
    "serviceWorker.register('./sw.js')",
  ]) {
    assert.ok(html.includes(s), `Missing ${s} in index.html`);
  }
});

test("Tv/index.html includes enTitleOf, tvGridFilterBar, Arab platforms, and backup embeds without forbidden strings", () => {
  const tv = readFileSync("Tv/index.html", "utf8");
  for (const s of [
    "enTitleOf",
    "tvGridFilterBar",
    "renderTvGridFilterBar",
    'data-tab="shahid"',
    'data-tab="watchit"',
    'data-tab="yango"',
    'data-tab="osn"',
    'data-tab="disney"',
    "SAFE_TV_EMBEDS",
    "fetchTvTmdbJson",
    "buildTvEmbedFallbacks",
  ]) {
    assert.ok(tv.includes(s), `Missing ${s} in Tv/index.html`);
  }
  for (const forbidden of [
    "window.open",
    "vidlink",
    "navigator.userAgent",
    "location.replace",
    "location.href =",
    "serviceWorker",
  ]) {
    assert.ok(!tv.includes(forbidden), `Tv/index.html must not contain ${forbidden}`);
  }
});

test("Android app configures PiP, smart back handling, and release update checks", () => {
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  const java = readFileSync("android/app/src/main/java/app/filmaty/MainActivity.java", "utf8");
  assert.ok(manifest.includes('android:supportsPictureInPicture="true"'));
  assert.ok(manifest.includes('android:resizeableActivity="true"'));
  assert.ok(java.includes("window.__filmatyHandleBack"));
  assert.ok(java.includes("enterPictureInPictureMode"));
  assert.ok(java.includes("onUserLeaveHint"));
  assert.ok(java.includes("onPictureInPictureModeChanged"));
  assert.ok(java.includes("checkForAppUpdate"));
  assert.ok(java.includes("api.github.com/repos/mmody1334-gif/filmaty/releases/latest"));
});
