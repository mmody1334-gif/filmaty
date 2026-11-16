import test from "node:test";
import assert from "node:assert/strict";
import { searchTitles, matchBrand } from "../src/engine/search.ts";

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

// TMDB discover results for Marvel (with_companies=420), popularity desc.
const marvelMovies = [
  { id: 299534, media_type: "movie", title: "Avengers: Endgame", original_title: "Avengers: Endgame", release_date: "2019-04-24", vote_average: 8.2, vote_count: 24000, popularity: 150, poster_path: "/endgame.jpg", overview: "The Avengers assemble." },
  { id: 1726, media_type: "movie", title: "Iron Man", original_title: "Iron Man", release_date: "2008-04-30", vote_average: 7.6, vote_count: 26000, popularity: 120, poster_path: "/ironman.jpg", overview: "Tony Stark builds a suit." },
  { id: 299537, media_type: "movie", title: "Captain Marvel", original_title: "Captain Marvel", release_date: "2019-03-06", vote_average: 6.8, vote_count: 15000, popularity: 90, poster_path: "/captain.jpg", overview: "Carol Danvers becomes Captain Marvel." },
  { id: 284054, media_type: "movie", title: "Thor: Ragnarok", original_title: "Thor: Ragnarok", release_date: "2017-10-25", vote_average: 7.6, vote_count: 21000, popularity: 80, poster_path: "/thor.jpg", overview: "Thor vs Hela." },
];
const marvelSeries = [
  { id: 1402, media_type: "tv", name: "Marvel's Daredevil", original_name: "Marvel's Daredevil", first_air_date: "2015-04-10", vote_average: 8.2, vote_count: 12000, popularity: 70, poster_path: "/daredevil.jpg", overview: "Blind lawyer by day." },
  { id: 84958, media_type: "tv", name: "Loki", original_name: "Loki", first_air_date: "2021-06-09", vote_average: 8.1, vote_count: 13000, popularity: 65, poster_path: "/loki.jpg", overview: "The God of Mischief." },
  { id: 107561, media_type: "tv", name: "Ms. Marvel", original_name: "Ms. Marvel", first_air_date: "2022-06-08", vote_average: 6.8, vote_count: 4000, popularity: 40, poster_path: "/msmarvel.jpg", overview: "Kamala Khan." },
];
// What TMDB title search used to return for "marvel": only titles that
// literally contain the word — mostly series, no Endgame/Iron Man.
const marvelTitleHits = [
  { id: 1402, media_type: "tv", name: "Marvel's Daredevil", original_name: "Marvel's Daredevil", first_air_date: "2015-04-10", vote_average: 8.2, vote_count: 12000, popularity: 70, poster_path: "/daredevil.jpg", overview: "Blind lawyer by day." },
  { id: 67482, media_type: "tv", name: "Marvel's The Punisher", original_name: "Marvel's The Punisher", first_air_date: "2017-11-17", vote_average: 8.1, vote_count: 9000, popularity: 60, poster_path: "/punisher.jpg", overview: "Frank Castle." },
  { id: 299537, media_type: "movie", title: "Captain Marvel", original_title: "Captain Marvel", release_date: "2019-03-06", vote_average: 6.8, vote_count: 15000, popularity: 90, poster_path: "/captain.jpg", overview: "Carol Danvers becomes Captain Marvel." },
];

function installMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const u = new URL(url);
    if (url.includes("api.themoviedb.org/3/discover/movie")) {
      return jsonResponse({ results: u.searchParams.get("with_companies") === "420" ? marvelMovies : [] });
    }
    if (url.includes("api.themoviedb.org/3/discover/tv")) {
      return jsonResponse({ results: u.searchParams.get("with_companies") === "420" ? marvelSeries : [] });
    }
    if (url.includes("api.themoviedb.org/3/search/multi")) {
      const q = u.searchParams.get("query") || "";
      return jsonResponse({ results: q === "marvel" || q === "مارفل" ? marvelTitleHits : [] });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    // Provider sites: empty pages -> no candidates.
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("matchBrand: latin, arabic and generic-word forms", () => {
  assert.equal(matchBrand("marvel")?.key, "marvel");
  assert.equal(matchBrand("Marvel")?.key, "marvel");
  assert.equal(matchBrand("مارفل")?.key, "مارفل");
  assert.equal(matchBrand("مارفيل")?.key, "مارفيل");
  assert.equal(matchBrand("افلام مارفل")?.key, "مارفل");
  assert.equal(matchBrand("Marvel movies")?.key, "marvel");
  assert.equal(matchBrand("المارفل")?.key, "مارفل");
  assert.equal(matchBrand("dc")?.key, "dc");
  assert.equal(matchBrand("دي سي")?.key, "دي سي");
  assert.equal(matchBrand("ديزني")?.key, "ديزني");
  assert.equal(matchBrand("بيكسار")?.key, "بيكسار");
  assert.equal(matchBrand("نتفليكس")?.key, "نتفليكس");
  assert.equal(matchBrand("وارنر")?.key, "وارنر");
});

test("matchBrand: title queries are NOT brands", () => {
  assert.equal(matchBrand("marvel endgame"), null);
  assert.equal(matchBrand("vision"), null);
  assert.equal(matchBrand("the 100"), null);
  assert.equal(matchBrand(""), null);
  assert.equal(matchBrand("افلام"), null);
});

test("brand query 'Marvel' returns the brand catalog: movies AND series", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const { results, source } = await searchTitles(env, "Marvel");
    assert.equal(source, "tmdb");
    // The famous movies the old title search could never return.
    assert.equal(results[0].id, 299534, "Avengers: Endgame must be first (most popular Marvel work)");
    assert.ok(results.some((r) => r.id === 1726), "Iron Man must be present");
    assert.ok(results.some((r) => r.id === 284054), "Thor: Ragnarok must be present");
    // Series are in the mix too.
    assert.ok(results.some((r) => r.id === 1402 && r.media_type === "tv"), "Daredevil must be present");
    assert.ok(results.some((r) => r.id === 84958), "Loki must be present");
    // No duplicates, and the title-only hit (Punisher) fills the pool.
    const keys = results.map((r) => `${r.media_type}:${r.id}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(results.some((r) => r.id === 67482), "Punisher (title-only hit) must fill the pool");
    assert.equal(results.length, 8);
  } finally {
    restore();
  }
});

test("brand query in Arabic 'مارفل' behaves the same", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const { results } = await searchTitles(env, "مارفل");
    assert.equal(results[0].id, 299534);
    assert.ok(results.some((r) => r.id === 1726));
    assert.ok(results.some((r) => r.id === 1402));
  } finally {
    restore();
  }
});

test("brand pool is capped at 10 movies + 10 series", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  // 12 movies + 12 series in discover: only the top 10 of each survive.
  const manyMovies = Array.from({ length: 12 }, (_, i) => ({
    id: 1000 + i, media_type: "movie", title: `Marvel Movie ${i}`,
    original_title: `Marvel Movie ${i}`, vote_count: 1000, popularity: 100 - i,
  }));
  const manySeries = Array.from({ length: 12 }, (_, i) => ({
    id: 2000 + i, media_type: "tv", name: `Marvel Show ${i}`,
    original_name: `Marvel Show ${i}`, vote_count: 1000, popularity: 88 - i,
  }));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const u = new URL(url);
    if (url.includes("api.themoviedb.org/3/discover/movie")) return jsonResponse({ results: manyMovies });
    if (url.includes("api.themoviedb.org/3/discover/tv")) return jsonResponse({ results: manySeries });
    return origFetch(input);
  };
  try {
    const { results } = await searchTitles(env, "marvel");
    assert.equal(results.length, 20);
    assert.ok(!results.some((r) => r.id === 1010), "11th movie (pop 90) must be cut");
    assert.ok(!results.some((r) => r.id === 2010), "11th series (pop 78) must be cut");
    assert.ok(results.some((r) => r.id === 1009), "10th movie must survive");
    assert.ok(results.some((r) => r.id === 2009), "10th series must survive");
  } finally {
    restore();
  }
});

test("'marvel endgame' does NOT take the brand path (it is a title search)", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    // No TMDB title hit for this mock query and no provider candidates:
    // the normal pipeline falls through to the provider fallback, so the
    // source must be "providers" — proving the brand path did not run.
    const { source } = await searchTitles(env, "marvel endgame");
    assert.equal(source, "providers");
  } finally {
    restore();
  }
});
