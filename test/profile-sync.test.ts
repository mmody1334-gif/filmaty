import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/index.ts";
import { normalizeUsername } from "../src/engine/profile.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";
const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

function createMockEnv(opts: { withD1?: boolean } = {}) {
  const kvMap = new Map<string, string>();
  const d1Rows = new Map<string, { username: string; data_json: string; updated_at: number }>();

  const env: any = {
    BOT_TOKEN: "test-bot-token",
    SIGNING_SECRET: SECRET,
    TMDB_KEY: "test-tmdb-key",
    PUBLIC_BASE: BASE,
    CACHE: {
      get: async (k: string) => kvMap.get(k) ?? null,
      put: async (k: string, v: string) => {
        kvMap.set(k, v);
      },
      delete: async (k: string) => {
        kvMap.delete(k);
      },
    },
  };

  if (opts.withD1) {
    env.DB = {
      prepare(sql: string) {
        let params: any[] = [];
        return {
          bind(...args: any[]) {
            params = args;
            return this;
          },
          async run() {
            if (sql.includes("INSERT INTO user_profiles")) {
              const [username, data_json, updated_at] = params;
              d1Rows.set(username, { username, data_json, updated_at });
            }
            return { success: true };
          },
          async first() {
            if (sql.includes("SELECT data_json FROM user_profiles")) {
              const row = d1Rows.get(String(params[0]));
              return row ? { data_json: row.data_json } : null;
            }
            return null;
          },
        };
      },
    };
  }

  return { env, kvMap, d1Rows };
}

test("normalizeUsername normalizes mixed case and rejects invalid names", () => {
  assert.equal(normalizeUsername("  Megoo  "), "megoo");
  assert.equal(normalizeUsername("محمد_99"), "محمد_99");
  assert.equal(normalizeUsername("a"), null);
  assert.equal(normalizeUsername("bad/slash"), null);
  assert.equal(normalizeUsername(""), null);
});

test("GET /api/profile?u=Megoo normalizes username and validates input", async () => {
  const { env } = createMockEnv({ withD1: true });
  const badRes = await worker.fetch(new Request(`${BASE}/api/profile?u=x`), env, {} as any);
  assert.equal(badRes.status, 400);

  const emptyRes = await worker.fetch(new Request(`${BASE}/api/profile?u=Megoo`), env, {} as any);
  assert.equal(emptyRes.status, 200);
  const body = (await emptyRes.json()) as any;
  assert.equal(body.ok, true);
  assert.equal(body.exists, false);
  assert.equal(body.profile.username, "megoo");
  assert.deepEqual(body.profile.history, []);
});

test("POST /api/profile saves megoo progress, myList, watched, history in D1 and KV", async () => {
  const { env, kvMap, d1Rows } = createMockEnv({ withD1: true });

  const postRes = await worker.fetch(
    new Request(`${BASE}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        username: "Megoo",
        progress: {
          "movie:299534:0:0": {
            type: "movie",
            id: 299534,
            s: 0,
            e: 0,
            t: 1840,
            d: 10860,
            updated: 2000,
            title: "Avengers: Endgame",
            poster: "https://image.tmdb.org/t/p/w500/p.jpg",
            kind: "movie",
          },
        },
        myList: {
          "tv:1405": {
            type: "tv",
            id: 1405,
            title: "Dexter",
            poster: "https://image.tmdb.org/t/p/w500/d.jpg",
            kind: "tv",
            added: 2000,
          },
        },
        history: [
          {
            type: "movie",
            id: 299534,
            s: 0,
            e: 0,
            title: "Avengers: Endgame",
            poster: "https://image.tmdb.org/t/p/w500/p.jpg",
            kind: "movie",
            at: 2100,
          },
        ],
      }),
    }),
    env,
    {} as any,
  );
  assert.equal(postRes.status, 200);
  assert.ok(d1Rows.has("megoo"), "D1 row should be stored under lowercase megoo");
  assert.ok(kvMap.has("profile:v1:megoo"), "KV mirror should be stored");

  const getRes = await worker.fetch(new Request(`${BASE}/api/profile?u=megoo`), env, {} as any);
  assert.equal(getRes.status, 200);
  const loaded = (await getRes.json()) as any;
  assert.equal(loaded.exists, true);
  assert.equal(loaded.profile.progress["movie:299534:0:0"].t, 1840);
  assert.equal(loaded.profile.myList["tv:1405"].title, "Dexter");
  assert.equal(loaded.profile.history[0].id, 299534);
});

test("POST /api/profile merges timestamps, watched clearing, myList tombstones and history dedupe", async () => {
  const { env } = createMockEnv({ withD1: false });

  await worker.fetch(
    new Request(`${BASE}/api/profile`, {
      method: "POST",
      body: JSON.stringify({
        username: "megoo",
        progress: {
          "movie:299534:0:0": {
            type: "movie",
            id: 299534,
            s: 0,
            e: 0,
            t: 900,
            d: 10860,
            updated: 1000,
            title: "Endgame",
            poster: "",
            kind: "movie",
          },
          "tv:1405:1:1": {
            type: "tv",
            id: 1405,
            s: 1,
            e: 1,
            t: 500,
            d: 3000,
            updated: 1200,
            title: "Dexter",
            poster: "",
            kind: "tv",
          },
        },
        myList: {
          "movie:550": {
            type: "movie",
            id: 550,
            title: "Fight Club",
            poster: "",
            kind: "movie",
            added: 1000,
          },
        },
        history: [
          { type: "movie", id: 299534, s: 0, e: 0, title: "Endgame", poster: "", kind: "movie", at: 1000 },
        ],
      }),
    }),
    env,
    {} as any,
  );

  // Device 2: newer Endgame progress, finishes Dexter S1E1 (watched at 2500),
  // explicitly removes Fight Club (removedAt 2200), watches Fight Club at 2600.
  const res2 = await worker.fetch(
    new Request(`${BASE}/api/profile`, {
      method: "POST",
      body: JSON.stringify({
        username: "megoo",
        progress: {
          "movie:299534:0:0": {
            type: "movie",
            id: 299534,
            s: 0,
            e: 0,
            t: 2450,
            d: 10860,
            updated: 3000,
            title: "Endgame",
            poster: "",
            kind: "movie",
          },
        },
        watched: { "tv:1405:1:1": 2500 },
        removedMyList: { "movie:550": 2200 },
        history: [
          { type: "movie", id: 299534, s: 0, e: 0, title: "Endgame", poster: "", kind: "movie", at: 3000 },
          { type: "movie", id: 550, s: 0, e: 0, title: "Fight Club", poster: "", kind: "movie", at: 2600 },
        ],
      }),
    }),
    env,
    {} as any,
  );
  const body2 = (await res2.json()) as any;
  assert.equal(body2.profile.progress["movie:299534:0:0"].t, 2450);
  assert.equal(body2.profile.progress["tv:1405:1:1"], undefined, "watched timestamp newer than progress must clear stale progress");
  assert.equal(body2.profile.myList["movie:550"], undefined, "removedMyList tombstone must prevent resurrection");
  assert.equal(body2.profile.history.length, 2, "duplicate Endgame history entries must dedupe");
  assert.equal(body2.profile.history[0].id, 299534);
  assert.equal(body2.profile.history[0].at, 3000);

  // Re-adding Fight Club later with a newer added timestamp restores it cleanly.
  const res3 = await worker.fetch(
    new Request(`${BASE}/api/profile`, {
      method: "POST",
      body: JSON.stringify({
        username: "megoo",
        myList: {
          "movie:550": { type: "movie", id: 550, title: "Fight Club", poster: "", kind: "movie", added: 4000 },
        },
      }),
    }),
    env,
    {} as any,
  );
  const body3 = (await res3.json()) as any;
  assert.equal(body3.profile.myList["movie:550"].title, "Fight Club");
});

test("GET /?movie=299534 injects dynamic OpenGraph tags while bare GET / does zero fetches", async () => {
  const { env } = createMockEnv();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    fetchCount++;
    const u = String(input);
    if (u.includes("api.themoviedb.org/3/movie/299534")) {
      return new Response(
        JSON.stringify({
          title: "المنتقمون: نهاية اللعبة",
          overview: "ملخص الفيلم",
          backdrop_path: "/or06FN3Dka5tukK1e9sl16pB3iy.jpg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404 });
  };

  try {
    const bareRes = await worker.fetch(new Request(`${BASE}/`), env, {} as any);
    assert.equal(bareRes.status, 200);
    assert.equal(fetchCount, 0, "bare root path must not make TMDB requests");

    const shareRes = await worker.fetch(new Request(`${BASE}/?movie=299534`), env, {} as any);
    assert.equal(shareRes.status, 200);
    assert.equal(fetchCount, 1);
    const html = await shareRes.text();
    assert.ok(html.includes('property="og:title" content="المنتقمون: نهاية اللعبة | فيلماتي"'));
    assert.ok(html.includes('property="og:image" content="https://image.tmdb.org/t/p/w1280/or06FN3Dka5tukK1e9sl16pB3iy.jpg"'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("main site renders movie links as <a href>, full-page watch view, prefetch, and profile sync", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  assert.ok(html.includes("<a href="), "movie cards must use native <a> links for right-click new tab");
  assert.ok(html.includes("cardHref("), "must build shareable movie/tv hrefs");
  assert.ok(html.includes("isModifiedCardClick("), "must preserve ctrl/middle-click new tab navigation");
  assert.ok(html.includes("pointer-events-none"), "poster images must let right-click hit the card anchor");
  assert.equal(html.includes("if (e.target === mediaModal)"), false, "clicking outside player must never dismiss watch page");
  assert.ok(html.includes('id="profileOverlay"'), "expected #profileOverlay");
  assert.ok(html.includes('id="profileBtn"'), "expected #profileBtn");
  assert.ok(html.includes("/api/profile"), "main site must sync with /api/profile");
  assert.ok(html.includes("filmaty:history:v1"), "main site must store watch history");
  assert.ok(html.includes("شاهدت مؤخراً"), "main site must render recent watch history row");
  assert.ok(html.includes("مقترحات عشانك"), "main site must render personalized recommendations row");
  assert.ok(html.includes("seeked"), "main site must persist progress on seek");
  assert.ok(html.includes("visibilitychange"), "main site must flush progress when tab hides");
  assert.ok(html.includes("prefetchResolve"), "main site must prefetch resolve on title open");
});

test("TV page includes profile switcher, cloud sync, history, recommendations, and seeked progress save", () => {
  const tv = readFileSync(join(process.cwd(), "Tv", "index.html"), "utf8");
  assert.ok(tv.includes('id="tvProfileOverlay"'), "expected #tvProfileOverlay");
  assert.ok(tv.includes('id="tvProfileBtn"'), "expected #tvProfileBtn");
  assert.ok(tv.includes("/api/profile"), "TV page must sync with /api/profile");
  assert.ok(tv.includes("filmaty:history:v1"), "TV page must share watch history storage key");
  assert.ok(tv.includes("شاهدت مؤخراً"), "TV home must render recent watch history row");
  assert.ok(tv.includes("مقترحات عشانك"), "TV home must render personalized recommendations row");
  assert.ok(tv.includes("seeked"), "TV video must persist progress on seek");
  assert.ok(tv.includes("visibilitychange"), "TV page must flush progress on visibilitychange");
});

test("inline <script> blocks in index.html and Tv/index.html parse cleanly", () => {
  for (const rel of ["index.html", join("Tv", "index.html")]) {
    const html = readFileSync(join(process.cwd(), rel), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, `expected inline scripts in ${rel}`);
    for (const m of scripts) {
      new Function(m[1]);
    }
  }
});
