import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { browseTitles } from "../src/engine/browse.ts";

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

const discoverItems = [
  {
    id: 101,
    title: "Hindi Film One",
    vote_average: 8.1,
    popularity: 60,
    poster_path: "/h1.jpg",
  },
  {
    id: 102,
    title: "Hindi Film Two",
    vote_average: 7.2,
    popularity: 40,
    poster_path: "/h2.jpg",
  },
];

// Records every TMDB discover URL the Worker requests.
function installMock() {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/discover/")) {
      seen.push(url);
      return jsonResponse({ results: discoverItems, total_pages: 4 });
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

test("GET /api/browse movie lang=hi returns items with media_type set", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&lang=hi&sort=popular&page=1`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.total_pages, 4);
    assert.equal(body.results.length, 2);
    assert.ok(body.results.every((r: any) => r.media_type === "movie"));
    assert.equal(body.results[0].id, 101);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    assert.equal(url.searchParams.get("with_original_language"), "hi");
    assert.equal(url.searchParams.get("sort_by"), "popularity.desc");
    assert.equal(url.searchParams.get("language"), "ar");
    assert.equal(url.searchParams.get("include_adult"), "false");
  } finally {
    restore();
  }
});

test("collection=marvel passes with_companies=420 and skips the language filter", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&collection=marvel`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    assert.equal(url.searchParams.get("with_companies"), "420");
    assert.equal(url.searchParams.get("with_original_language"), null);
  } finally {
    restore();
  }
});

test("collection=netflix uses with_networks=213 for tv and with_companies=11946 for movies", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const tvRes = await worker.fetch(
      new Request(`${BASE}/api/browse?type=tv&collection=netflix`),
      env,
      {} as any,
    );
    assert.equal(tvRes.status, 200);
    const movieRes = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&collection=netflix`),
      env,
      {} as any,
    );
    assert.equal(movieRes.status, 200);
    assert.equal(seen.length, 2);
    assert.equal(new URL(seen[0]).searchParams.get("with_networks"), "213");
    assert.equal(new URL(seen[1]).searchParams.get("with_companies"), "11946");
  } finally {
    restore();
  }
});

test("sort=top_rated sorts by vote_average with a vote-count floor", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/browse?type=tv&sort=top_rated&page=2`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    assert.equal(url.searchParams.get("sort_by"), "vote_average.desc");
    assert.equal(url.searchParams.get("vote_count.gte"), "300");
    assert.equal(url.searchParams.get("page"), "2");
  } finally {
    restore();
  }
});

test("browse omits the language filter when lang is omitted (global)", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(new Request(`${BASE}/api/browse?type=tv`), env, {} as any);
    assert.equal(res.status, 200);
    assert.equal(new URL(seen[0]).searchParams.get("with_original_language"), null);
  } finally {
    restore();
  }
});

test("origin=US sets with_origin_country=US (American English)", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/browse?type=movie&lang=en&origin=US&sort=popular&page=1`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    assert.equal(url.searchParams.get("with_original_language"), "en");
    assert.equal(url.searchParams.get("with_origin_country"), "US");
  } finally {
    restore();
  }
});

test("origin works without lang and is uppercased", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/browse?type=tv&origin=us`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    const url = new URL(seen[0]);
    assert.equal(url.searchParams.get("with_origin_country"), "US");
    assert.equal(url.searchParams.get("with_original_language"), null);
  } finally {
    restore();
  }
});

test("origin is part of the cache key", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    await browseTitles(env, { type: "movie", lang: "en", origin: "US", sort: "popular", page: 1 });
    await browseTitles(env, { type: "movie", lang: "en", origin: "US", sort: "popular", page: 1 });
    assert.equal(seen.length, 1);
    await browseTitles(env, { type: "movie", lang: "en", origin: "GB", sort: "popular", page: 1 });
    assert.equal(seen.length, 2);
  } finally {
    restore();
  }
});

test("invalid browse params return 400", async () => {
  const { restore } = installMock();
  const { env } = mockEnv();
  try {
    for (const qs of [
      "type=person",
      "type=movie&lang=xx",
      "type=movie&sort=latest",
      "type=movie&page=0",
      "type=movie&page=501",
      "type=movie&page=abc",
      "type=movie&collection=disney",
      "type=movie&origin=USA",
      "type=movie&origin=U",
      "type=movie&origin=1S",
      "lang=ar",
    ]) {
      const res = await worker.fetch(new Request(`${BASE}/api/browse?${qs}`), env, {} as any);
      assert.equal(res.status, 400, `expected 400 for ?${qs}, got ${res.status}`);
    }
  } finally {
    restore();
  }
});

test("identical browse calls are served from cache (one TMDB fetch)", async () => {
  const { seen, restore } = installMock();
  const { env } = mockEnv();
  try {
    const first = await browseTitles(env, { type: "movie", lang: "hi", sort: "popular", page: 1 });
    const second = await browseTitles(env, { type: "movie", lang: "hi", sort: "popular", page: 1 });
    assert.equal(first.results.length, 2);
    assert.deepEqual(second, first);
    assert.equal(seen.length, 1);
  } finally {
    restore();
  }
});
