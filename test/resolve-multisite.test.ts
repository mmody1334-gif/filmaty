import test from "node:test";
import assert from "node:assert/strict";
import { resolveServersByTmdb } from "../src/engine/resolve.ts";
import { searchAllProviders } from "../src/providers/index.ts";

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
    puts,
    env: {
      TMDB_KEY: "test-tmdb-key",
      PUBLIC_BASE: "https://filmaty.hudhaifa-bio.workers.dev",
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

// VisionQuest S1E1, reduced from the live diagnosis (2026-11-16):
// Akwam HAS the file but on CDN node s204d1, which accepts TCP+TLS and
// then never answers — the Range probe times out and the stream is
// rejected. Laroza has the SAME episode with a working direct mp4.
// The resolver must fall through to Laroza instead of reporting
// "no download". Before the per-site fix, searchAllProviders merged
// same-title candidates across providers, so Laroza's copy was dropped
// and only Akwam's dead file was ever tried.

const AKWAM_SEARCH_HTML = `
<html><body>
<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/5854/visionquest-1">VisionQuest (الموسم 1)</a></h3></div>
</body></html>
`;

const AKWAM_SERIES_PAGE = `
<html><head><title>VisionQuest | اكوام</title></head><body>
<a href="https://akwam.ss/episode/103604/visionquest/الحلقة-8">حلقة 8 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103603/visionquest/الحلقة-7">حلقة 7 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103602/visionquest/الحلقة-6">حلقة 6 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103601/visionquest/الحلقة-5">حلقة 5 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103600/visionquest/الحلقة-4">حلقة 4 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103599/visionquest/الحلقة-3">حلقة 3 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103598/visionquest/الحلقة-2">حلقة 2 : مسلسل VisionQuest</a>
<a href="https://akwam.ss/episode/103597/visionquest/الحلقة-1">حلقة 1 : مسلسل VisionQuest</a>
</body></html>
`;

const AKWAM_E1_PAGE = `
<html><body>
<a href="https://akwam.ss/watch/182776/103597/visionquest/الحلقة-1">مشاهدة 720p</a>
<a href="https://akwam.ss/download/182776/103597/visionquest/الحلقة-1">تحميل 720p (415 MB)</a>
</body></html>
`;

const AKWAM_WATCH_HTML = `
<html><body>
<video>
<source src="https://s204d1.downet.net/download/1794927140/6afb18a493c2d/VisionQuest.S01E01.mp4">
</video>
</body></html>
`;

const EGYBEST_SEARCH_HTML = `
<html><body>
<a href="https://iegybest.cimawbas.tv/watch.php?vid=5c70b0344" title="مسلسل VisionQuest">VisionQuest</a>
</body></html>
`;

const LAROZA_SEARCH_HTML = `
<html><body>
<a href="https://laroza1.bond/video.php?vid=935f0b66d" title="مسلسل VisionQuest">VisionQuest</a>
</body></html>
`;

const LAROZA_DETAILS_HTML = `
<html><head><title>VisionQuest الحلقة 1 | لاروزا</title></head><body>
<h1>VisionQuest الحلقة 1</h1>
</body></html>
`;

const LAROZA_DL_HTML = `
<html><body>
<a href="https://okprimeone.site/v/02/00029/r8n0acfs1dpj_n/VisionQuest.S01E01.mp4">720p (415 MB)</a>
</body></html>
`;

function installMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/tv/213375")) {
      return jsonResponse({
        id: 213375,
        name: "VisionQuest",
        original_name: "VisionQuest",
        first_air_date: "2026-01-01",
      });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(AKWAM_SEARCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/series/5854")) {
      return new Response(AKWAM_SERIES_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/episode/103597")) {
      return new Response(AKWAM_E1_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/watch/182776")) {
      return new Response(AKWAM_WATCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("iegybest.cimawbas.tv/search.php")) {
      return new Response(EGYBEST_SEARCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("laroza1.bond/search.php")) {
      return new Response(LAROZA_SEARCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("laroza1.bond/video.php?vid=935f0b66d")) {
      return new Response(LAROZA_DETAILS_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("laroza1.bond/download.php?vid=935f0b66d")) {
      return new Response(LAROZA_DL_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    // The dead Akwam node: accepts the connection, never answers.
    if (url.includes("s204d1.downet.net")) {
      throw new Error("fetch failed");
    }
    if (url.includes("okprimeone.site")) {
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/415000000",
          "Content-Length": "1",
        },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("searchAllProviders keeps one candidate per title by default, one per site with keepPerSite", async () => {
  const restore = installMock();
  try {
    const merged = await searchAllProviders("VisionQuest", "series");
    const mergedSites = merged.filter((c) => c.title === "VisionQuest").map((c) => c.site);
    assert.equal(mergedSites.length, 1, "default merge keeps a single exact-title VisionQuest candidate");

    const perSite = await searchAllProviders("VisionQuest", "series", [], true);
    const perSiteSites = perSite.filter((c) => c.title === "VisionQuest").map((c) => c.site);
    assert.ok(perSiteSites.includes("egybest"), "per-site keeps EgyBest");
    assert.ok(perSiteSites.includes("laroza"), "per-site keeps Laroza");
    assert.ok(perSiteSites.includes("laroza"), "per-site keeps Laroza");
  } finally {
    restore();
  }
});

test("VisionQuest S1E1 resolves to Laroza when Akwam's only file is on a dead node", async () => {
  const restore = installMock();
  try {
    const { env, puts } = mockEnv();
    const result = await resolveServersByTmdb(env, "tv", 213375, 1, 1);
    assert.ok(result, "resolve must succeed via the second provider");
    assert.equal(result!.servers.length, 1);
    assert.match(result!.servers[0].name, /لاروزا|laroza/i);
    assert.equal(result!.servers[0].qualities.length, 1);
    assert.match(result!.servers[0].qualities[0].quality, /720p/);
    assert.equal(
      result!.servers[0].qualities[0].directVideoUrl,
      "https://okprimeone.site/v/02/00029/r8n0acfs1dpj_n/VisionQuest.S01E01.mp4",
    );
    // Laroza's okprimeone links are signed and expire after 2h, so the
    // resolve must cache for 1h only — a 6h cache kept serving dead
    // links and downloads failed with "Upstream error: HTTP 403".
    assert.equal(
      puts.find((p) => p.key === "srv9:tv:213375:1:1")?.ttl,
      1 * 3600,
      "Laroza resolves cache for 1h",
    );
  } finally {
    restore();
  }
});

test("Laroza series page: episode <select> maps every episode to its own page", async () => {
  const { LarozaProvider } = await import("../src/providers/laroza.ts");
  const SELECT_PAGE = `
<html><head><title>مسلسل VisionQuest الموسم الاول الحلقة 2 الثانية مترجمة</title></head><body>
<ul aria-label="اختيار الموسم">
  <li data-serie="1" class="active"><button class="lr-episode-season-tab" type="button">الموسم 1 <span class="lr-season-tab-count">(9 حلقة)</span></button></li>
</ul>
<select aria-label="Episodes" class="episodeoption" id="MSeason1">
  <option value="select-ep">قائمه الحلقات</option>
  <option value='video.php?vid=51eb1353d'> الحلقة 1</option>
  <option selected value='video.php?vid=935f0b66d'> الحلقة 2</option>
  <option value='video.php?vid=ca3aa4f29'> الحلقة 3</option>
  <option value='video.php?vid=4de45820f'> الحلقة 4</option>
</select>
<a href="./video.php?vid=51eb1353d">الحلقة السابقة 1</a>
<a href="./video.php?vid=ca3aa4f29">الحلقة التالية 3</a>
</body></html>
`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("laroza1.bond/video.php?vid=935f0b66d")) {
      return new Response(SELECT_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  try {
    const provider = new LarozaProvider();
    const details = await provider.getDetails({
      id: "laroza:935f0b66d",
      title: "VisionQuest",
      kind: "series",
      site: "laroza",
      siteLabel: "لاروزا",
      url: "https://laroza1.bond/video.php?vid=935f0b66d",
    });
    assert.equal(details.seasons.length, 1);
    const eps = details.seasons[0].episodes;
    // All 4 episodes from the <select>, each with its own vid — and
    // NOT the prev/next anchors misnumbered by list order.
    assert.deepEqual(
      eps.map((e) => e.episode),
      [1, 2, 3, 4],
    );
    assert.equal(eps[3].url, "https://laroza1.bond/video.php?vid=4de45820f");
    assert.equal(eps[0].url, "https://laroza1.bond/video.php?vid=51eb1353d");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("matchesKnownTitles: Arabic+English combined title matches, spin-off does not", async () => {
  const { matchesKnownTitles } = await import("../src/engine/resolve.ts");
  const known = ["나의 유죄인간", "Love in Disguise", "حب متنكر"];
  assert.equal(matchesKnownTitles("حب متنكر Love in Disguise", known), true);
  assert.equal(matchesKnownTitles("Love in Disguise حب متنكر", known), true);
  assert.equal(matchesKnownTitles("Dexter: Resurrection", ["Dexter"]), false);
  assert.equal(matchesKnownTitles("VisionQuest (الموسم 1)", ["VisionQuest"]), true);
  assert.equal(matchesKnownTitles("The 100 (الموسم 7)", ["The 100"]), true);
  assert.equal(matchesKnownTitles("حب متنكر الموسم 1", known), true);
});

test("حب متنكر S1E1 resolves via the Arabic display title when the original is Korean", async () => {
  const HM_SEARCH_HTML = `
<html><body>
<a href="https://laroza1.bond/video.php?vid=hmep1" title="مسلسل حب متنكر Love in Disguise">حب متنكر Love in Disguise</a>
</body></html>
`;
  const HM_DETAILS_HTML = `
<html><head><title>مسلسل حب متنكر Love in Disguise الموسم الاول الحلقة 1 مترجمة</title></head><body>
<ul aria-label="اختيار الموسم">
  <li data-serie="1" class="active"><button class="lr-episode-season-tab" type="button">الموسم 1</button></li>
</ul>
<select aria-label="Episodes" class="episodeoption" id="MSeason1">
  <option value="select-ep">قائمه الحلقات</option>
  <option selected value='video.php?vid=hmep1'> الحلقة 1</option>
  <option value='video.php?vid=hmep2'> الحلقة 2</option>
</select>
</body></html>
`;
  const HM_DL_HTML = `
<html><body>
<a href="https://okprimeone.site/v/02/00029/hm/HM.S01E01.mp4">720p (400 MB)</a>
</body></html>
`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/tv/303745") && url.includes("language=en-US")) {
      return jsonResponse({ id: 303745, name: "Love in Disguise", original_name: "나의 유죄인간", first_air_date: "2026-01-01" });
    }
    if (url.includes("api.themoviedb.org/3/tv/303745") && url.includes("language=ar")) {
      return jsonResponse({ id: 303745, name: "حب متنكر", original_name: "나의 유죄인간", first_air_date: "2026-01-01" });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("laroza1.bond/search.php")) {
      // Laroza's site search only finds the show by its Arabic name —
      // the English/Korean query rounds must yield nothing here, so the
      // resolve has to fall through to the Arabic round (the lazy
      // multi-round path). Returning the candidate for every query
      // would let the English round resolve it and hide a regression
      // of that fall-through.
      if (decodeURIComponent(url).includes("حب متنكر")) {
        return new Response(HM_SEARCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("laroza1.bond/video.php?vid=hmep1")) {
      return new Response(HM_DETAILS_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("laroza1.bond/download.php?vid=hmep1")) {
      return new Response(HM_DL_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("okprimeone.site")) {
      return new Response("x", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/400000000", "Content-Length": "1" },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  try {
    const { env } = mockEnv();
    const result = await resolveServersByTmdb(env, "tv", 303745, 1, 1);
    assert.ok(result, "resolve must succeed via the Arabic display title");
    assert.match(result!.servers[0].name, /لاروزا|laroza/i);
    assert.equal(
      result!.servers[0].qualities[0].directVideoUrl,
      "https://okprimeone.site/v/02/00029/hm/HM.S01E01.mp4",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
