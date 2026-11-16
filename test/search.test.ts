import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { searchTitles } from "../src/engine/search.ts";
import { titlesMatch } from "../src/engine/resolve.ts";

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

const interstellarHit = {
  id: 157336,
  media_type: "movie",
  title: "Interstellar",
  original_title: "Interstellar",
  release_date: "2014-11-05",
  vote_average: 8.4,
  popularity: 90,
  poster_path: "/interstellar.jpg",
  overview: "A team of explorers travel through a wormhole in space.",
};

const fightClubAr = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  original_title: "Fight Club",
  release_date: "1999-10-15",
  vote_average: 8.8,
  popularity: 10,
  poster_path: "/ar.jpg",
  overview: "",
};

const fightClubEn = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  original_title: "Fight Club",
  release_date: "1999-10-15",
  vote_average: 8.8,
  popularity: 50,
  poster_path: "/en.jpg",
  overview: "An insomniac office worker and a devil-may-care soap maker form an underground fight club.",
};

const personHit = {
  id: 819,
  media_type: "person",
  name: "Edward Norton",
  popularity: 40,
};

// Re-rank fixtures: "vision" — the ar list holds an unrelated popular
// item that the old no-rank merge put first; the en list holds
// WandaVision (contains-match) and "The Vision" (contains-match, less
// popular). "dark" — exact / starts-with / contains chain.
const randomShow = {
  id: 9001,
  media_type: "tv",
  title: "Random Show",
  original_title: "Random Show",
  vote_average: 5.0,
  vote_count: 5000,
  popularity: 200,
  poster_path: "/random.jpg",
  overview: "",
};

const wandaVisionEn = {
  id: 85271,
  media_type: "tv",
  title: "WandaVision",
  original_title: "WandaVision",
  first_air_date: "2021-01-15",
  vote_average: 8.3,
  vote_count: 13058,
  popularity: 95,
  poster_path: "/wandavision.jpg",
  overview: "",
};

const visionOn = {
  id: 9007,
  media_type: "tv",
  title: "Vision On",
  original_title: "Vision On",
  vote_average: 7.0,
  vote_count: 40,
  popularity: 3,
  poster_path: "/visionon.jpg",
  overview: "",
};

const theVision = {
  id: 9002,
  media_type: "tv",
  title: "The Vision",
  original_title: "The Vision",
  vote_average: 6.0,
  vote_count: 200,
  popularity: 12,
  poster_path: "/vision.jpg",
  overview: "",
};

const darkExact = {
  id: 9003,
  media_type: "tv",
  title: "Dark",
  original_title: "Dark",
  vote_average: 8.0,
  popularity: 5,
  poster_path: "/dark.jpg",
  overview: "",
};

const darkness = {
  id: 9004,
  media_type: "movie",
  title: "Darkness",
  original_title: "Darkness",
  vote_average: 6.5,
  popularity: 50,
  poster_path: "/darkness.jpg",
  overview: "",
};

const darkKnight = {
  id: 9005,
  media_type: "movie",
  title: "The Dark Knight",
  original_title: "The Dark Knight",
  vote_average: 9.0,
  popularity: 90,
  poster_path: "/tdk.jpg",
  overview: "",
};

// "فيجن" (normalized form of "ڤيجن"): TMDB ar returns واندافيجن and
// "رحلة ڤيجن" — both contains-matches, so popularity must break the tie.
const wandaVisionAr = {
  id: 85271,
  media_type: "tv",
  title: "واندافيجن",
  original_title: "WandaVision",
  first_air_date: "2021-01-15",
  vote_average: 8.3,
  vote_count: 13058,
  popularity: 95,
  poster_path: "/wandavision.jpg",
  overview: "",
};

const rahlaVision = {
  id: 9006,
  media_type: "movie",
  title: "رحلة ڤيجن",
  original_title: "رحلة ڤيجن",
  vote_average: 4.0,
  popularity: 3,
  poster_path: "/rahla.jpg",
  overview: "",
};

// TMDB search results keyed by (query, language). The "Interstellar" key
// serves the provider-fallback attach search for "Interstellar فيلم".
function tmdbSearchResult(query: string, lang: string): any[] {
  if (query === "interstellar") {
    return lang === "en-US" ? [interstellarHit] : [];
  }
  if (query === "dup") {
    return lang === "ar" ? [fightClubAr] : [fightClubEn];
  }
  if (query === "mixed") {
    return lang === "en-US" ? [personHit, interstellarHit] : [];
  }
  if (query === "Interstellar") {
    return [interstellarHit];
  }
  if (query === "vision") {
    return lang === "ar" ? [visionOn, randomShow] : [wandaVisionEn, theVision];
  }
  if (query === "dark") {
    return lang === "en-US" ? [darkExact, darkness, darkKnight] : [];
  }
  if (query === "فيجن") {
    return lang === "ar" ? [wandaVisionAr, rahlaVision] : [];
  }
  return [];
}

function installMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/search/multi")) {
      const u = new URL(url);
      return jsonResponse({
        results: tmdbSearchResult(u.searchParams.get("query") || "", u.searchParams.get("language") || ""),
      });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    // All provider sites: empty pages -> no candidates except the pure
    // embed provider, which generates one from the query.
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("ar-empty/en-hit merges into one result", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const { results, source } = await searchTitles(env, "interstellar");
    assert.equal(source, "tmdb");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 157336);
    assert.equal(results[0].title, "Interstellar");
  } finally {
    restore();
  }
});

test("duplicate ids are deduped, keeping the more complete entry", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const { results, source } = await searchTitles(env, "dup");
    assert.equal(source, "tmdb");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 550);
    // The en-US entry (longer overview, higher popularity) wins.
    assert.ok(results[0].overview!.includes("insomniac"));
    assert.equal(results[0].poster_path, "/en.jpg");
  } finally {
    restore();
  }
});

test("non-movie/tv media types are filtered out", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const { results } = await searchTitles(env, "mixed");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 157336);
    assert.equal(results[0].media_type, "movie");
  } finally {
    restore();
  }
});

test("re-rank puts the best match first: 'vision' ranks WandaVision first", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    // Live bug: q=vision returned an unrelated ar hit first and buried
    // WandaVision (no re-ranking — ar order won). The re-rank scores
    // WandaVision and "The Vision" as contains-matches (1) and the
    // unrelated ar hit as 0 — and the fame bonus (vote_count) lets hugely
    // famous WandaVision (13k votes) outrank the little-known
    // starts-with match "Vision On" (live: Vision On was first,
    // WandaVision buried). The local index also contributes VisionQuest
    // (a brand-new 2026 show, 499 votes) — it ranks below WandaVision
    // on fame, which is exactly why the bonus uses vote_count and not
    // popularity (VisionQuest's popularity, 308, dwarfs WandaVision's 35).
    const { results, source } = await searchTitles(env, "vision");
    assert.equal(source, "tmdb");
    assert.deepEqual(
      results.map((r) => r.title),
      // "VisionQuest" (id 213375) displays under its Arabic title.
      ["WandaVision", "رحلة ڤيجن", "Vision On", "The Vision", "Random Show"],
    );
  } finally {
    restore();
  }
});

test("re-rank orders exact > starts-with > contains", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    // The local index also contributes the real "The Dark Knight" (155)
    // for q=dark, so the full list is no longer just the three mock
    // titles — assert the mock trio's relative order instead.
    const { results } = await searchTitles(env, "dark");
    const ids = results.map((r) => r.id);
    assert.ok(ids.includes(9003) && ids.includes(9004) && ids.includes(9005));
    assert.ok(ids.indexOf(9003) < ids.indexOf(9004), "exact 'Dark' must precede starts-with 'Darkness'");
    assert.ok(ids.indexOf(9004) < ids.indexOf(9005), "starts-with 'Darkness' must precede contains 'The Dark Knight'");
    assert.ok(ids.includes(155), "the local index must contribute the real The Dark Knight");
  } finally {
    restore();
  }
});

test("normalized Arabic query 'ڤيجن' finds واندافيجن first", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    // Live bug: q=ڤيجن returned only "رحلة ڤيجن" (ڤ ≠ ف in TMDB's
    // index). The normalized query "فيجن" matches واندافيجن; both hits
    // are contains-matches, so the more popular one wins.
    const { results, source } = await searchTitles(env, "ڤيجن");
    assert.equal(source, "tmdb");
    assert.equal(results[0].title, "واندافيجن");
    assert.ok(results.some((r) => r.title === "رحلة ڤيجن"));
  } finally {
    restore();
  }
});

// Live-faithful TMDB mapping for the augmentation tests: TMDB's word
// index never returns WandaVision for "vision" (compound token), and
// returns nothing at all for the normalized "فيجن" — the provider
// augmentation is what finds it. Attach lookups by exact title do
// return the hit.
function tmdbSearchResultLive(query: string, lang: string): any[] {
  if (query === "vision") {
    return lang === "ar" ? [visionOn, randomShow] : [theVision];
  }
  if (query === "فيجن") return [];
  if (query === "WandaVision") return [wandaVisionEn];
  if (query === "واندافيجن") return [wandaVisionAr];
  return [];
}

function installAugmentMock(akwamHtml: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/search/multi")) {
      const u = new URL(url);
      return jsonResponse({
        results: tmdbSearchResultLive(u.searchParams.get("query") || "", u.searchParams.get("language") || ""),
      });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(akwamHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("provider augmentation finds WandaVision for q=vision (TMDB never returns it)", async () => {
  const restore = installAugmentMock(`
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/movie/85271/wandavision">WandaVision</a></h3></div>
  `);
  const { env } = mockEnv();
  try {
    // Live: TMDB returns only word-matches for "vision" (Vision On,
    // The Vision...) and no WandaVision at all. Akwam's substring
    // search finds it, the attach maps it to TMDB 85271, and the
    // re-rank puts it first.
    const { results, source } = await searchTitles(env, "vision");
    assert.equal(source, "tmdb");
    assert.equal(results[0].id, 85271);
    assert.equal(results[0].title, "WandaVision");
  } finally {
    restore();
  }
});

test("provider augmentation finds واندافيجن for q=ڤيجن (TMDB returns nothing)", async () => {
  const restore = installAugmentMock(`
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/movie/85271/wandavision">واندافيجن</a></h3></div>
  `);
  const { env } = mockEnv();
  try {
    // Live: TMDB ar returns 0 hits for the normalized "فيجن", so
    // without augmentation this fell back to a junk provider-only
    // entry. Akwam finds واندافيجن, the attach maps it to TMDB 85271.
    const { results, source } = await searchTitles(env, "ڤيجن");
    assert.equal(source, "tmdb");
    assert.equal(results[0].id, 85271);
    assert.equal(results[0].title, "واندافيجن");
  } finally {
    restore();
  }
});

test("TMDB empty falls back to provider search (provider-only entries)", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const { results, source } = await searchTitles(env, "nothing");
    assert.equal(source, "providers");
    assert.ok(results.length >= 1);
    const first = results[0];
    assert.equal(first.id, null);
    assert.equal(first.title, "nothing");
    assert.ok(first.providerUrl, "provider-only entry must carry a URL to open");
    assert.ok(first.provider, "provider-only entry must name its provider");
  } finally {
    restore();
  }
});

test("provider fallback attaches a TMDB id when the title matches", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    // Direct TMDB search for "Interstellar فيلم" returns nothing; the
    // provider candidate title is "Interstellar", which TMDB does know.
    const { results, source } = await searchTitles(env, "Interstellar فيلم");
    assert.equal(source, "providers");
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, 157336);
    assert.equal(results[0].media_type, "movie");
  } finally {
    restore();
  }
});

test("GET /api/search returns merged TMDB results", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/search?q=interstellar`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.source, "tmdb");
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].id, 157336);
  } finally {
    restore();
  }
});

test("GET /api/search returns provider fallback when TMDB is empty", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/search?q=nothing`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.source, "providers");
    assert.equal(body.results[0].id, null);
    assert.ok(body.results[0].providerUrl);
  } finally {
    restore();
  }
});

test("GET /api/search without q returns 400", async () => {
  const restore = installMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(new Request(`${BASE}/api/search`), env, {} as any);
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.ok, false);
  } finally {
    restore();
  }
});

test("provider fallback drops loose substring matches for an Arabic query TMDB does not know", async () => {
  const originalFetch = globalThis.fetch;
  // TMDB itself returns 0 hits for "المئة" (verified live); the providers
  // return an exact match plus a junk substring match — only the exact
  // match may be shown.
  const akwamHtml = `
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/9001/abu-al-arousa">ابو العروسة الجزء الثانى المئة</a></h3></div>
    <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/9002/al-mia">المئة</a></h3></div>
  `;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(akwamHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  const { env } = mockEnv();
  try {
    const { results, source } = await searchTitles(env, "المئة");
    assert.equal(source, "providers");
    assert.ok(results.length >= 1);
    // The junk substring match must be gone; every remaining entry must
    // strictly match the query (a season suffix like "(الموسم 1)" is fine).
    assert.ok(
      results.every((r) => titlesMatch(r.title || r.name || "", "المئة")),
      `junk substring match leaked through: ${results.map((r) => r.title || r.name).join(" | ")}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local index finds WandaVision for q=vision when TMDB and providers find nothing", async () => {
  const originalFetch = globalThis.fetch;
  // TMDB's word index can never return the compound title "WandaVision"
  // for "vision" (verified live), and no provider search returns it for
  // the Latin query either — the baked-in index is the only source.
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  const { env } = mockEnv();
  try {
    const { results, source } = await searchTitles(env, "vision");
    assert.equal(source, "tmdb");
    assert.ok(results.length > 0);
    assert.equal(results[0].id, 85271);
    assert.equal(results[0].media_type, "tv");
    assert.ok(results[0].poster_path, "index hit must carry a poster");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
