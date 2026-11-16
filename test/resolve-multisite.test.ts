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
  return {
    env: {
      TMDB_KEY: "test-tmdb-key",
      PUBLIC_BASE: "https://filmaty.hudhaifa-bio.workers.dev",
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
    const { env } = mockEnv();
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
  } finally {
    restore();
  }
});
