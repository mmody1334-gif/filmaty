import test from "node:test";
import assert from "node:assert/strict";
import { resolveServersByTmdb } from "../src/engine/resolve.ts";
import { AkwamProvider } from "../src/providers/akwam.ts";

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
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: "test-secret-key-at-least-32-characters-long",
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

// The real Akwam season-7 page for The 100, reduced: episodes listed
// newest-first (E16 first), link texts in bare "حلقة N" form (no ال),
// E12's URL slug carries no episode number, and one junk link carries
// no number anywhere (it must be skipped, not mislabelled).
const S7_PAGE = `
<html><head><title>The 100 (الموسم 7) | اكوام</title></head><body>
<a href="https://akwam.ss/episode/15927/the-100-الموسم-السابع/الحلقة-16">حلقة 16 : مسلسل The 100 الموسم السابع The Last War الاخيرة</a>
<a href="https://akwam.ss/episode/15927/the-100-الموسم-السابع/الحلقة-16"></a>
<a href="https://akwam.ss/episode/15472/the-100-الموسم-السابع/الحلقة-15">حلقة 15 : مسلسل The 100 الموسم السابع The Dying of the Light</a>
<a href="https://akwam.ss/episode/15114/the-100-الموسم-السابع/الحلقة-14">حلقة 14 : مسلسل The 100 الموسم السابع A Sort of Homecoming</a>
<a href="https://akwam.ss/episode/14896/the-100-الموسم-السابع/الحلقة-13">حلقة 13 : مسلسل The 100 الموسم السابع Blood Giant</a>
<a href="https://akwam.ss/episode/13767/the-stranger">حلقة 12 : مسلسل The 100 الموسم السابع The Stranger</a>
<a href="https://akwam.ss/episode/13260/the-100-الموسم-السابع/الحلقة-11">حلقة 11 : مسلسل The 100 الموسم السابع Etherea</a>
<a href="https://akwam.ss/episode/12902/the-100-الموسم-السابع/الحلقة-10">حلقة 10 : مسلسل The 100 الموسم السابع A Little Sacrifice</a>
<a href="https://akwam.ss/episode/10757/the-flock">حلقة 9 : مسلسل The 100 الموسم السابع The Flock</a>
<a href="https://akwam.ss/episode/9965/the-100-الموسم-السابع/الحلقة-8">حلقة 8 : مسلسل The 100 الموسم السابع Anaconda</a>
<a href="https://akwam.ss/episode/9363/the-100-الموسم-السابع/الحلقة-7">حلقة 7 : مسلسل The 100 الموسم السابع The Queen's Gambit</a>
<a href="https://akwam.ss/episode/8690/nakara">حلقة 6 : مسلسل The 100 الموسم السابع Nakara</a>
<a href="https://akwam.ss/episode/8495/welcome-to-bardo">حلقة 5 : مسلسل The 100 الموسم السابع Welcome to Bardo</a>
<a href="https://akwam.ss/episode/7985/hesperides">حلقة 4 : مسلسل The 100 الموسم السابع Hesperides</a>
<a href="https://akwam.ss/episode/7620/false-gods">حلقة 3 : مسلسل The 100 الموسم السابع False Gods</a>
<a href="https://akwam.ss/episode/7105/the-garden">حلقة 2 : مسلسل The 100 الموسم السابع The Garden</a>
<a href="https://akwam.ss/episode/6803/from-the-ashes">حلقة 1 : مسلسل The 100 الموسم السابع From the Ashes</a>
<a href="https://akwam.ss/episode/6803/from-the-ashes"></a>
<a href="https://akwam.ss/episode/99999/trailer">مشاهدة الاعلان الرسمي</a>
</body></html>
`;

const SEARCH_HTML = `
<html><body>
<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/433/the-100-الموسم-السابع">The 100 (الموسم 7)</a></h3></div>
</body></html>
`;

const E1_PAGE = `
<html><body>
<a href="https://akwam.ss/episode/6803/from-the-ashes">حلقة 1</a>
<a href="https://akwam.ss/watch/33628/6803/the-100-الموسم-السابع/الحلقة-1">مشاهدة 720p</a>
<a href="https://akwam.ss/download/33628/6803/the-100-الموسم-السابع/الحلقة-1">تحميل 720p (350 MB)</a>
</body></html>
`;

const WATCH_HTML = `
<html><body>
<video>
<source src="https://s301d3.downet.net/download/1/The.100.S07E01.720p.WEB.AKWAM.mp4">
<source src="https://s301d3.downet.net/download/1/The.100.S07E01.480p.WEB.AKWAM.mp4">
</video>
</body></html>
`;

function installMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/tv/48866")) {
      return jsonResponse({
        id: 48866,
        name: "The 100",
        original_name: "The 100",
        first_air_date: "2014-03-19",
      });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(SEARCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/series/433")) {
      return new Response(S7_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/episode/6803")) {
      return new Response(E1_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("akwam.ss/watch/")) {
      return new Response(WATCH_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("downet.net")) {
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/350000000",
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

const S7_CANDIDATE = {
  id: "akwam:s7",
  title: "The 100 (الموسم 7)",
  kind: "series" as const,
  site: "akwam",
  siteLabel: "أكوام",
  url: "https://akwam.ss/series/433/the-100-الموسم-السابع",
};

test("Akwam S7 page (newest-first, bare حلقة N) maps episodes to the right URLs", async () => {
  const restore = installMock();
  try {
    const akwam = new AkwamProvider();
    const details = await akwam.getDetails(S7_CANDIDATE);
    assert.equal(details.seasons.length, 1);
    assert.equal(details.seasons[0].season, 7);
    const eps = details.seasons[0].episodes;
    // 16 real episodes; the unnumbered trailer link is skipped, not mislabelled.
    assert.equal(eps.length, 16);
    assert.deepEqual(
      eps.map((e) => e.episode),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    );
    assert.equal(eps[0].url, "https://akwam.ss/episode/6803/from-the-ashes");
    assert.equal(eps[15].url, "https://akwam.ss/episode/15927/the-100-الموسم-السابع/الحلقة-16");
    // E12's slug carries no number — it still parses from the link text.
    assert.equal(eps[11].url, "https://akwam.ss/episode/13767/the-stranger");
  } finally {
    restore();
  }
});

test("resolveServersByTmdb returns the S07E01 file for an S7E1 request", async () => {
  const restore = installMock();
  try {
    const { env } = mockEnv();
    const result = await resolveServersByTmdb(env, "tv", 48866, 7, 1);
    assert.ok(result, "expected a result");
    const files = result!.servers[0].qualities.map((q) => q.directVideoUrl);
    assert.ok(files.length >= 1);
    assert.ok(
      files.every((f) => f.includes("S07E01")),
      `expected S07E01 files, got ${files.join(", ")}`,
    );
    assert.ok(!files.some((f) => f.includes("S07E16")), "must not return the E16 file");
  } finally {
    restore();
  }
});
