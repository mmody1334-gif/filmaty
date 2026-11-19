import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { recordView } from "../src/engine/home.ts";
import { FILMATY_WEBAPP_HTML } from "../src/player/webapp-html.ts";

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

// Mocked TMDB: details for Interstellar + Game of Thrones, trending, and
// top_rated lists. `calls` counts TMDB fetches (for the cache test).
function installMock(calls: { tmdb: number }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org")) {
      calls.tmdb++;
      if (url.includes("/3/movie/157336")) {
        return jsonResponse({
          id: 157336,
          title: "Interstellar",
          original_title: "Interstellar",
          release_date: "2014-11-05",
          vote_average: 8.4,
          poster_path: "/interstellar.jpg",
          overview: "A team of explorers travel through a wormhole in space.",
        });
      }
      if (url.includes("/3/tv/1399")) {
        return jsonResponse({
          id: 1399,
          name: "Game of Thrones",
          original_name: "Game of Thrones",
          first_air_date: "2011-04-17",
          vote_average: 9.2,
          poster_path: "/got.jpg",
          overview: "Nine noble families fight for control of Westeros.",
        });
      }
      if (url.includes("/trending/all/day")) {
        return jsonResponse({
          results: [
            { id: 550, media_type: "movie", title: "Fight Club", release_date: "1999-10-15", vote_average: 8.8, poster_path: "/fc.jpg" },
            { id: 1399, media_type: "tv", name: "Game of Thrones", first_air_date: "2011-04-17", vote_average: 9.2, poster_path: "/got.jpg" },
          ],
        });
      }
      if (url.includes("/movie/top_rated")) {
        return jsonResponse({
          results: [
            { id: 238, title: "The Godfather", release_date: "1972-03-14", vote_average: 9.2, poster_path: "/gf.jpg" },
            { id: 550, title: "Fight Club", release_date: "1999-10-15", vote_average: 8.8, poster_path: "/fc.jpg" },
          ],
        });
      }
      if (url.includes("/tv/top_rated")) {
        return jsonResponse({
          results: [
            { id: 1399, name: "Game of Thrones", first_air_date: "2011-04-17", vote_average: 9.2, poster_path: "/got.jpg" },
            { id: 1402, name: "The Walking Dead", first_air_date: "2010-10-31", vote_average: 8.1, poster_path: "/twd.jpg" },
          ],
        });
      }
      return jsonResponse({ results: [] });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("recordView increments the counter and orders the top list", async () => {
  const { env, map } = mockEnv();
  const first = await recordView(env, "movie", 157336);
  assert.equal(first.count, 1);
  const second = await recordView(env, "movie", 157336);
  assert.equal(second.count, 2);
  const third = await recordView(env, "tv", 1399);
  assert.equal(third.count, 1);

  assert.equal(map.get("views:movie:157336"), "2");
  assert.equal(map.get("views:tv:1399"), "1");
  const top = JSON.parse(map.get("views:top")!);
  assert.deepEqual(top, [
    { type: "movie", id: 157336, count: 2 },
    { type: "tv", id: 1399, count: 1 },
  ]);
});

test("POST /api/view returns the count and increments on repeat", async () => {
  const { env } = mockEnv();
  const post = async (body: any) =>
    worker.fetch(
      new Request(`${BASE}/api/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
      {} as any,
    );
  const r1 = await post({ type: "movie", id: 157336 });
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, count: 1 });
  const r2 = await post({ type: "movie", id: 157336 });
  assert.deepEqual(await r2.json(), { ok: true, count: 2 });
  const bad = await post({ type: "song", id: 1 });
  assert.equal(bad.status, 400);
});

test("GET /api/home falls back to TMDB trending when no views exist", async () => {
  const calls = { tmdb: 0 };
  const restore = installMock(calls);
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(new Request(`${BASE}/api/home`), env, {} as any);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    // mostWatched = trending fallback (never empty).
    assert.deepEqual(
      body.mostWatched.map((i: any) => i.id),
      [550, 1399],
    );
    // topRated = movie + tv top_rated merged, sorted by vote_average desc.
    assert.deepEqual(
      body.topRated.map((i: any) => i.id),
      [238, 1399, 550, 1402],
    );
    assert.deepEqual(
      body.topRated.map((i: any) => i.media_type),
      ["movie", "tv", "movie", "tv"],
    );
  } finally {
    restore();
  }
});

test("GET /api/home mostWatched comes from the views counter", async () => {
  const calls = { tmdb: 0 };
  const restore = installMock(calls);
  const { env, map } = mockEnv();
  map.set(
    "views:top",
    JSON.stringify([
      { type: "tv", id: 1399, count: 5 },
      { type: "movie", id: 157336, count: 3 },
    ]),
  );
  try {
    const res = await worker.fetch(new Request(`${BASE}/api/home`), env, {} as any);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(
      body.mostWatched.map((i: any) => i.id),
      [1399, 157336],
    );
    assert.equal(body.mostWatched[0].name, "Game of Thrones");
    assert.equal(body.mostWatched[1].title, "Interstellar");
    assert.equal(body.mostWatched[0].media_type, "tv");
    assert.equal(body.mostWatched[1].media_type, "movie");
  } finally {
    restore();
  }
});

test("GET /api/home is cached: a second call makes no new TMDB fetches", async () => {
  const calls = { tmdb: 0 };
  const restore = installMock(calls);
  const { env } = mockEnv();
  try {
    const r1 = await worker.fetch(new Request(`${BASE}/api/home`), env, {} as any);
    assert.equal(r1.status, 200);
    const afterFirst = calls.tmdb;
    assert.ok(afterFirst >= 3, `expected TMDB fetches on first call, got ${afterFirst}`);
    const r2 = await worker.fetch(new Request(`${BASE}/api/home`), env, {} as any);
    assert.equal(r2.status, 200);
    assert.equal(calls.tmdb, afterFirst, "second call must be served from the KV cache");
    const b1 = (await r1.json()) as any;
    const b2 = (await r2.json()) as any;
    assert.deepEqual(b2, b1);
  } finally {
    restore();
  }
});

// The year filter lives in inline frontend JS (not importable), so it is
// covered by asserting the built webapp carries the sections, the year
// chips and the filter logic.
test("built webapp has the home sections, year chips and view counting", () => {
  for (const s of [
    "الأكثر مشاهدة",
    "الأعلى تقييمًا",
    "homeSections",
    "home-year-chip",
    "filterHomeList",
    "2026",
    "2025",
    "2024",
    "2023",
    "أقدم",
    "/api/home",
    "/api/view",
    "recordViewOnce",
  ]) {
    assert.ok(FILMATY_WEBAPP_HTML.includes(s), `built webapp must contain: ${s}`);
  }
  // Home (most-watched first) is the initial view, not the old trending grid.
  assert.ok(!FILMATY_WEBAPP_HTML.includes("loadTrending()"));
});

// The hamburger drawer + browse categories live in inline frontend JS
// (not importable), so they are covered by asserting the built webapp
// carries the drawer, the language items, the /api/browse calls — and no
// direct-browser TMDB discover call anymore.
test("built webapp has the hamburger drawer, browse categories and no direct discover", () => {
  for (const s of [
    "menuBtn",
    "sideDrawer",
    "drawerOverlay",
    "drawerClose",
    "drawer-group-btn",
    "drawer-lang",
    'data-lang="ar"',
    'data-lang="en"',
    'data-lang="hi"',
    'data-lang="tr"',
    'data-lang="ko"',
    'data-lang="es"',
    'data-lang="fr"',
    'data-lang="ja"',
    // Arabic + American English are prominent; the other languages live
    // under a «لغات أخرى» sub-group inside each of movies/series.
    "لغات أخرى",
    "drawer-movies-other",
    "drawer-tv-other",
    'data-origin="US"',
    "إنجليزي (أمريكي)",
    "الأعلى تقييمًا",
    "🦸‍♂️ مارفل",
    "🔴 نتفليكس",
    "/api/browse",
    "loadBrowse",
    "loadBrowseLanguage",
    "loadTopRated",
    "LANG_LABELS",
    "عربية",
    "هندية",
    "openDrawer",
    "closeDrawer",
  ]) {
    assert.ok(FILMATY_WEBAPP_HTML.includes(s), `built webapp must contain: ${s}`);
  }
  // All browsing goes through /api/browse now: no direct TMDB discover
  // call may remain in the frontend.
  assert.ok(!FILMATY_WEBAPP_HTML.includes("/discover/"), "no direct TMDB discover call left");
  assert.ok(!FILMATY_WEBAPP_HTML.includes("loadDiscover"), "loadDiscover must be gone");
});

// The native player must tolerate a slow cold start (verified live:
// Interstellar 1080p needed well over 15s before readyState 2, then
// played fine). The videoIframe tag itself carries no sandbox attribute
// in the HTML (it is set from JS), and the embedwave server is always
// sandboxed so its popups stay blocked — there is no unsandboxed
// server anymore (vidlink was removed). The ONE exception is the
// trailer: the YouTube embed (a trusted Google player) plays without
// a sandbox, and embedwave re-adds its sandbox on every play.
test("built webapp gives slow streams 45s and always sandboxes the embed iframe", () => {
  assert.ok(
    FILMATY_WEBAPP_HTML.includes("}, 45000);"),
    "built webapp must arm the no-data timeout at 45s",
  );
  const iframeTag = FILMATY_WEBAPP_HTML.match(/<iframe id="videoIframe"[^>]*>/)?.[0] ?? "";
  assert.ok(iframeTag.length > 0, "built webapp must contain the videoIframe tag");
  assert.ok(!iframeTag.includes("sandbox"), "the videoIframe tag must not carry a sandbox attribute");
  for (const s of [
    "setAttribute('sandbox', EMBEDWAVE_SANDBOX)",
    "loadEmbedFallback",
    // The embedwave server name (its embed URL is built server-side).
    "'embedwave'",
    "allow-popups",
  ]) {
    assert.ok(FILMATY_WEBAPP_HTML.includes(s), `built webapp must contain: ${s}`);
  }
  // The sandbox may only ever be removed for the YouTube trailer, or
  // inside the Android app (IN_APP), whose shell blocks popups natively.
  const inApp = [...FILMATY_WEBAPP_HTML.matchAll(/if \(IN_APP\) videoIframe\.removeAttribute\('sandbox'\);/g)];
  assert.equal(inApp.length, 1, "exactly one app-only sandbox removal");
  assert.ok(FILMATY_WEBAPP_HTML.includes("const IN_APP = /FilmatyApp\\//.test(navigator.userAgent);"), "IN_APP must be UA-gated");
  const removals = [...FILMATY_WEBAPP_HTML.replace(/if \(IN_APP\) videoIframe\.removeAttribute\('sandbox'\);/g, "").matchAll(/removeAttribute\('sandbox'\)/g)];
  assert.equal(removals.length, 1, "the sandbox must be removed in exactly one place (the trailer)");
  const stripped = FILMATY_WEBAPP_HTML.replace(/if \(IN_APP\) videoIframe\.removeAttribute\('sandbox'\);/g, "");
  const around = stripped.slice(Math.max(0, removals[0].index - 400), removals[0].index + 400);
  assert.ok(around.includes("youtube.com/embed/"), "the single sandbox removal must be the YouTube trailer handler");
  assert.ok(!FILMATY_WEBAPP_HTML.includes("vidlink"), "no vidlink fallback may remain in the player");
});
