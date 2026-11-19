import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";
import { recordView } from "../src/engine/home.ts";
import { archiveResolvedStreamD1, getArchivedStreamD1, topViewedFromD1 } from "../src/engine/db.ts";
import { isAllowedSubtitleUrl, srtToVtt } from "../src/engine/subtitles.ts";
import { top10CacheKey, cairoDateKey } from "../src/engine/top10.ts";

const BASE = "https://filmaty.hudhaifa-bio.workers.dev";
const SECRET = "test-secret-key-at-least-32-characters-long";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFullMockEnv() {
  const kv = new Map<string, string>();
  const views = new Map<string, { media_type: string; tmdb_id: number; views: number; updated_at: number }>();
  const streams = new Map<string, { title: string; payload_json: string; resolved_at: number }>();
  const profiles = new Map<string, { data_json: string; updated_at: number }>();

  const env: any = {
    BOT_TOKEN: "test-bot-token",
    SIGNING_SECRET: SECRET,
    TMDB_KEY: "test-tmdb-key",
    PUBLIC_BASE: BASE,
    CACHE: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        kv.set(k, v);
      },
      delete: async (k: string) => {
        kv.delete(k);
      },
    },
    DB: {
      prepare(sql: string) {
        let params: any[] = [];
        return {
          bind(...args: any[]) {
            params = args;
            return this;
          },
          async run() {
            if (sql.includes("INSERT INTO title_views")) {
              const [key, media_type, tmdb_id, updated_at] = params;
              const cur = views.get(String(key));
              views.set(String(key), {
                media_type: String(media_type),
                tmdb_id: Number(tmdb_id),
                views: (cur?.views || 0) + 1,
                updated_at: Number(updated_at),
              });
            } else if (sql.includes("INSERT INTO resolved_streams")) {
              const [cache_key, , , , , title, payload_json, resolved_at] = params;
              streams.set(String(cache_key), {
                title: String(title),
                payload_json: String(payload_json),
                resolved_at: Number(resolved_at),
              });
            } else if (sql.includes("INSERT INTO user_profiles")) {
              const [username, data_json, updated_at] = params;
              profiles.set(String(username), {
                data_json: String(data_json),
                updated_at: Number(updated_at),
              });
            }
            return { success: true };
          },
          async first() {
            if (sql.includes("SELECT views FROM title_views")) {
              const row = views.get(String(params[0]));
              return row ? { views: row.views } : null;
            }
            if (sql.includes("SELECT title, payload_json, resolved_at FROM resolved_streams")) {
              return streams.get(String(params[0])) ?? null;
            }
            if (sql.includes("SELECT data_json FROM user_profiles")) {
              const row = profiles.get(String(params[0]));
              return row ? { data_json: row.data_json } : null;
            }
            return null;
          },
          async all() {
            if (sql.includes("FROM title_views")) {
              const limit = Number(params[0]) || 20;
              const results = [...views.values()]
                .sort((a, b) => b.views - a.views || b.updated_at - a.updated_at)
                .slice(0, limit);
              return { results };
            }
            return { results: [] };
          },
        };
      },
    },
  };

  return { env, kv, views, streams, profiles };
}

test("#5 D1 atomic title_views and redacted resolved_streams archival", async () => {
  const { env, streams } = createFullMockEnv();
  await recordView(env, "movie", 157336);
  await recordView(env, "movie", 157336);
  const res3 = await recordView(env, "movie", 157336);
  assert.equal(res3.count, 3);

  const d1Top = await topViewedFromD1(env, 10);
  assert.ok(d1Top && d1Top.length === 1);
  assert.equal(d1Top[0].id, 157336);
  assert.equal(d1Top[0].count, 3);

  const saved = await archiveResolvedStreamD1(env, {
    type: "tv",
    id: 1399,
    s: 1,
    e: 2,
    title: "Game of Thrones",
    servers: [
      { name: "akwam", qualities: [{ quality: "1080p" }, { quality: "720p" }] },
    ],
  });
  assert.equal(saved, true);
  assert.ok(streams.has("tv:1399:1:2"));
  const archived = await getArchivedStreamD1(env, "tv", 1399, 1, 2);
  assert.ok(archived);
  assert.equal(archived.title, "Game of Thrones");
  assert.deepEqual(archived.payload.servers[0], { name: "akwam", qualities: ["1080p", "720p"] });
});

test("#2 GET /api/top10-egypt returns platformsByType {movie, tv} under v2 daily cache", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/discover/tv?")) {
      return jsonResponse({
        results: [{ id: 1001, name: "مسلسل مصري", poster_path: "/tv.jpg", popularity: 200, vote_average: 8.2 }],
      });
    }
    if (url.includes("/discover/movie?")) {
      return jsonResponse({
        results: [{ id: 2001, title: "فيلم عربي", poster_path: "/mv.jpg", popularity: 300, vote_average: 7.9 }],
      });
    }
    return jsonResponse({ results: [] });
  };
  const { env, kv } = createFullMockEnv();
  try {
    const res = await worker.fetch(new Request(`${BASE}/api/top10-egypt`), env, {} as any);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.platformsByType);
    for (const k of ["netflix", "shahid", "yango", "watchit"]) {
      assert.ok(body.platforms[k].length >= 1);
      assert.ok(body.platformsByType[k].movie.length >= 1, `${k} missing movie slice`);
      assert.ok(body.platformsByType[k].tv.length >= 1, `${k} missing tv slice`);
    }
    const cacheKey = top10CacheKey(cairoDateKey());
    assert.ok(cacheKey.startsWith("top10eg:v2:"));
    assert.ok(kv.has(cacheKey));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("#8 subtitles helper converts SRT->VTT cleanly and blocks SSRF/unsafe redirects", async () => {
  const vtt = srtToVtt("\uFEFF1\r\n00:01:02,345 --> 00:01:05,678\r\nمرحباً بكم\r\n");
  assert.ok(vtt.startsWith("WEBVTT\n"));
  assert.ok(vtt.includes("00:01:02.345 --> 00:01:05.678"));
  assert.ok(vtt.includes("مرحباً بكم"));
  assert.ok(!vtt.includes("\n1\n"));

  assert.ok(isAllowedSubtitleUrl("https://subs5.strem.io/subtitles/test.srt"));
  assert.equal(isAllowedSubtitleUrl("http://subs5.strem.io/subtitles/test.srt"), null);
  assert.equal(isAllowedSubtitleUrl("https://127.0.0.1/secret.srt"), null);
  assert.equal(isAllowedSubtitleUrl("https://evil.example.com/a.srt"), null);
  assert.equal(isAllowedSubtitleUrl("https://user@subs5.strem.io/a.srt"), null);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("/external_ids")) {
      return jsonResponse({ imdb_id: "tt0816692" });
    }
    if (url.includes("opensubtitles-v3.strem.io/subtitles/movie/tt0816692.json")) {
      return jsonResponse({
        subtitles: [
          { id: "e1", lang: "eng", url: "https://subs5.strem.io/en1.srt" },
          { id: "a1", lang: "ara", url: "https://subs5.strem.io/ar1.srt" },
        ],
      });
    }
    if (url === "https://opensubtitles-v3.strem.io/redir-evil") {
      return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } });
    }
    if (url === "https://subs5.strem.io/ar1.srt") {
      return new Response("1\n00:00:01,000 --> 00:00:03,000\nترجمة عربية", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  };
  const { env } = createFullMockEnv();
  try {
    const idxRes = await worker.fetch(new Request(`${BASE}/api/subtitles?type=movie&id=157336`), env, {} as any);
    assert.equal(idxRes.status, 200);
    const idxBody = (await idxRes.json()) as any;
    assert.equal(idxBody.imdbId, "tt0816692");
    assert.equal(idxBody.tracks.length, 2);
    assert.equal(idxBody.tracks[0].langCode, "ar");
    assert.equal(idxBody.tracks[1].langCode, "en");

    const forbiddenRes = await worker.fetch(
      new Request(`${BASE}/api/subtitles?src=${encodeURIComponent("https://evil.com/x.srt")}`),
      env,
      {} as any,
    );
    assert.equal(forbiddenRes.status, 403);

    const redirRes = await worker.fetch(
      new Request(`${BASE}/api/subtitles?src=${encodeURIComponent("https://opensubtitles-v3.strem.io/redir-evil")}`),
      env,
      {} as any,
    );
    assert.equal(redirRes.status, 403);

    const vttRes = await worker.fetch(
      new Request(`${BASE}/api/subtitles?src=${encodeURIComponent("https://subs5.strem.io/ar1.srt")}`),
      env,
      {} as any,
    );
    assert.equal(vttRes.status, 200);
    assert.match(vttRes.headers.get("content-type") || "", /text\/vtt/);
    const vttText = await vttRes.text();
    assert.ok(vttText.startsWith("WEBVTT"));
    assert.ok(vttText.includes("ترجمة عربية"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("#6 #7 #17 #22 expanded /api/tmdb allowlist and cache key scoping", async () => {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    seen.push(String(input));
    return jsonResponse({ ok: true, results: [] });
  };
  const { env, kv } = createFullMockEnv();
  try {
    for (const p of [
      "/collection/86311",
      "/person/500/combined_credits",
      "/movie/157336/release_dates",
      "/tv/1399/content_ratings",
      "/movie/157336/credits",
      "/tv/on_the_air",
    ]) {
      const r = await worker.fetch(
        new Request(`${BASE}/api/tmdb?path=${encodeURIComponent(p)}&lang=ar`),
        env,
        {} as any,
      );
      assert.equal(r.status, 200, `expected 200 for ${p}`);
    }

    await worker.fetch(
      new Request(`${BASE}/api/tmdb?path=%2Fmovie%2Fupcoming&lang=ar&region=EG&page=2`),
      env,
      {} as any,
    );
    assert.ok(kv.has("tmdb1:/movie/upcoming:ar::r:EG:p:2"));
    assert.match(seen[seen.length - 1], /region=EG/);
    assert.match(seen[seen.length - 1], /page=2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("#10 /api/browse forwards min_rating and max_runtime and rejects bad values", async () => {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.includes("/discover/") && !u.includes("language=en-US")) seen.push(u);
    return jsonResponse({ results: [{ id: 1, title: "Fast Night" }], total_pages: 1 });
  };
  const { env } = createFullMockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&genre=28&min_rating=7.5&max_runtime=95&page=1`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    const parsed = new URL(seen[0]);
    assert.equal(parsed.searchParams.get("vote_average.gte"), "7.5");
    assert.equal(parsed.searchParams.get("with_runtime.lte"), "95");

    const badRate = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&min_rating=14`),
      env,
      {} as any,
    );
    assert.equal(badRate.status, 400);

    const badRt = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&max_runtime=5`),
      env,
      {} as any,
    );
    assert.equal(badRt.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("#15 #25 /api/profile persists family avatar and history genreIds/runtime", async () => {
  const { env } = createFullMockEnv();
  const postRes = await worker.fetch(
    new Request(`${BASE}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        username: "megoo",
        avatar: "🦉",
        history: [
          {
            type: "movie",
            id: 157336,
            s: 0,
            e: 0,
            title: "Interstellar",
            poster: "",
            kind: "movie",
            at: 5000,
            genreIds: [18, 878],
            runtime: 169,
          },
        ],
      }),
    }),
    env,
    {} as any,
  );
  assert.equal(postRes.status, 200);

  const getRes = await worker.fetch(new Request(`${BASE}/api/profile?u=megoo`), env, {} as any);
  const data = (await getRes.json()) as any;
  assert.equal(data.profile.avatar, "🦉");
  assert.deepEqual(data.profile.history[0].genreIds, [18, 878]);
  assert.equal(data.profile.history[0].runtime, 169);
});

test("index.html and Tv/index.html have zero duplicate IDs, clean JS syntax, and all Stage 2-4 hooks", () => {
  const checkFile = (relPath: string, requiredIds: string[]) => {
    const html = readFileSync(relPath, "utf8");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const dups = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
    assert.deepEqual(dups, [], `Duplicate IDs in ${relPath}: ${dups.join(", ")}`);

    for (const reqId of requiredIds) {
      assert.ok(html.includes(`id="${reqId}"`), `Missing #${reqId} in ${relPath}`);
    }

    const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter((m) => !/\bsrc\s*=/.test(m[1]) && m[2].trim().length > 0);
    assert.ok(scriptMatches.length >= 1, `Expected inline script in ${relPath}`);
    for (const m of scriptMatches) {
      new Function(m[2]);
    }
    return html;
  };

  const webHtml = checkFile("index.html", [
    "btnMoodPicker",
    "moodModal",
    "btnCalendar",
    "calendarModal",
    "searchFilterBar",
    "hoverPreviewLayer",
    "profileAvatarPicker",
    "profileTabStats",
    "profileExportBtn",
    "profileImportBtn",
    "btnSubtitles",
    "subtitleMenu",
    "btnSkipIntro",
    "sleepTimerSelect",
    "gestureHud",
    "modalCert",
    "modalRuntime",
    "collectionWrap",
    "castWrap",
  ]);
  const removeSandboxMatches = webHtml.match(/removeAttribute\(['"]sandbox['"]\)/g) || [];
  assert.equal(removeSandboxMatches.length, 2, "hover preview must never remove sandbox");

  const tvHtml = checkFile("Tv/index.html", [
    "tvAvatarPicker",
    "tvCert",
    "tvRuntime",
    "tvSkipIntroBtn",
    "tvSleepBtn",
  ]);
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
});
