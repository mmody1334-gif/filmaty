import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { searchTitles } from "../src/engine/search.ts";

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
