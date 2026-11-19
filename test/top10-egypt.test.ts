import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";
import { cairoDateKey, top10CacheKey } from "../src/engine/top10.ts";

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

function installTop10Mock() {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (!url.includes("api.themoviedb.org/3/discover/")) {
      return jsonResponse({ results: [] });
    }
    calls += 1;
    const isEn = url.includes("language=en-US");
    const isTv = url.includes("/discover/tv?");
    if (url.includes("with_watch_providers=8") || url.includes("with_networks=213")) {
      return jsonResponse({
        results: [
          {
            id: isTv ? 9101 : 9102,
            ...(isTv ? { name: isEn ? "Netflix Hit Show" : "مسلسل نتفليكس الأول" } : { title: isEn ? "Netflix Hit Movie" : "فيلم نتفليكس الأول" }),
            poster_path: "/nf1.jpg",
            popularity: 420,
            vote_average: 8.1,
            first_air_date: isTv ? "2026-10-01" : undefined,
            release_date: isTv ? undefined : "2026-11-01",
          },
        ],
      });
    }
    if (url.includes("with_networks=3626") || url.includes("with_watch_providers=1715")) {
      return jsonResponse({
        results: [
          {
            id: 9201,
            ...(isTv ? { name: isEn ? "Shahid Hit" : "عمل شاهد الأول" } : { title: isEn ? "Shahid Movie" : "فيلم شاهد الأول" }),
            poster_path: "/sh1.jpg",
            popularity: 310,
            vote_average: 8.4,
            release_date: "2026-09-10",
            first_air_date: "2026-09-10",
          },
        ],
      });
    }
    if (url.includes("with_networks=7736") || url.includes("with_companies=260351")) {
      return jsonResponse({
        results: isTv
          ? [
              {
                id: 9301,
                name: isEn ? "Watar Hasas" : "وتر حساس",
                poster_path: "/yg1.jpg",
                popularity: 220,
                vote_average: 7.8,
                first_air_date: "2026-08-05",
              },
            ]
          : [],
      });
    }
    if (url.includes("with_networks=4786") || url.includes("with_companies=137350")) {
      return jsonResponse({
        results: [
          {
            id: 9401,
            ...(isTv ? { name: isEn ? "El Hashashin" : "الحشاشين" } : { title: isEn ? "WatchIt Film" : "فيلم واتش إت" }),
            poster_path: "/wi1.jpg",
            popularity: 280,
            vote_average: 8.6,
            first_air_date: "2026-03-01",
            release_date: "2026-03-01",
          },
        ],
      });
    }
    return jsonResponse({
      results: Array.from({ length: 12 }, (_, idx) => ({
        id: 9500 + idx,
        title: isEn ? `EG Movie ${idx + 1}` : `فيلم مصري ${idx + 1}`,
        poster_path: `/eg${idx + 1}.jpg`,
        popularity: 100 - idx,
        vote_average: 7.2,
        release_date: "2026-05-01",
      })),
    });
  };
  return {
    getCalls: () => calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

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

test("cairoDateKey formats YYYY-MM-DD in Cairo timezone (UTC+2)", () => {
  // 2026-11-19T22:30:00Z is 2026-11-20T00:30:00 in UTC+2 Cairo.
  assert.equal(cairoDateKey(new Date("2026-11-19T22:30:00.000Z")), "2026-11-20");
  assert.equal(cairoDateKey(new Date("2026-11-19T21:59:59.000Z")), "2026-11-19");
});

test("GET /api/top10-egypt returns ranked titles with title_en and caches daily in KV", async () => {
  const { getCalls, restore } = installTop10Mock();
  const { map, puts, env } = mockEnv();
  try {
    const res1 = await worker.fetch(new Request(`${BASE}/api/top10-egypt`), env, {} as any);
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as any;
    assert.equal(body1.ok, true);
    assert.equal(body1.region, "EG");
    assert.match(body1.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(body1.updatedAt);

    for (const k of ["netflix", "shahid", "yango", "watchit"]) {
      assert.ok(Array.isArray(body1.platforms[k]), `expected array for ${k}`);
      assert.ok(body1.platforms[k].length >= 1, `expected at least 1 item for ${k}`);
      assert.equal(body1.platforms[k][0].rank, 1);
      assert.ok(body1.platforms[k][0].title_en, `expected title_en for ${k}`);
    }
    assert.equal(body1.platforms.yango.length, 10, "yango should pad up to 10 items cleanly");

    const cacheKey = top10CacheKey(body1.date);
    assert.ok(map.has(cacheKey));
    const putRecord = puts.find((p) => p.key === cacheKey);
    assert.equal(putRecord?.ttl, 26 * 3600);

    const callsAfterFirst = getCalls();
    const res2 = await worker.fetch(new Request(`${BASE}/api/top10-egypt`), env, {} as any);
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as any;
    assert.deepEqual(body2.platforms.netflix, body1.platforms.netflix);
    assert.equal(getCalls(), callsAfterFirst, "second request must hit KV cache");
  } finally {
    restore();
  }
});

test("worker.scheduled warms daily top10eg KV key", async () => {
  const { restore } = installTop10Mock();
  const { map, env } = mockEnv();
  const waits: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => waits.push(p),
    passThroughOnException: () => {},
  } as any;
  try {
    await worker.scheduled({} as any, env, ctx);
    await Promise.all(waits);
    const expectedKey = top10CacheKey(cairoDateKey());
    assert.ok(map.has(expectedKey), `expected cron to warm ${expectedKey}`);
  } finally {
    restore();
  }
});

test("index.html renders Egypt Top 10 rows in exact order with valid inline JS", () => {
  const html = readFileSync("index.html", "utf8");
  for (const needle of [
    "/api/top10-egypt",
    "egyptTop10SectionsHtml",
    "top10PlatformCardHtml",
    "EGYPT_TOP10_PLATFORMS",
    "TOP 10",
  ]) {
    assert.ok(html.includes(needle), `Missing ${needle} in index.html`);
  }

  const blockStart = html.indexOf("const EGYPT_TOP10_PLATFORMS");
  const blockEnd = html.indexOf("];", blockStart);
  const block = html.slice(blockStart, blockEnd);
  const keys = [...block.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["netflix", "shahid", "yango", "watchit"]);

  for (const code of extractInlineScripts(html)) {
    new Function(code);
  }
});

test("Tv/index.html renders Egypt Top 10 rows in exact order, stays watch-only, and parses cleanly", () => {
  const tv = readFileSync("Tv/index.html", "utf8");
  for (const needle of [
    "/api/top10-egypt",
    "tvEgyptTop10SectionsHtml",
    "TV_EGYPT_TOP10_PLATFORMS",
    "TOP 10",
  ]) {
    assert.ok(tv.includes(needle), `Missing ${needle} in Tv/index.html`);
  }

  const blockStart = tv.indexOf("const TV_EGYPT_TOP10_PLATFORMS");
  const blockEnd = tv.indexOf("];", blockStart);
  const block = tv.slice(blockStart, blockEnd);
  const keys = [...block.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["netflix", "shahid", "yango", "watchit"]);

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
    assert.ok(!tv.includes(forbidden), `Tv/index.html must not contain ${forbidden}`);
  }

  for (const code of extractInlineScripts(tv)) {
    new Function(code);
  }
});
