import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { verifyToken } from "../src/engine/token.ts";
import { downloadDisplayName } from "../src/engine/filenames.ts";

// Download file names: every episode must save under its own name.
// Regression: a whole season downloaded as the bare title
// ("VisionQuest.mp4" for every episode), because the resolve token
// carried only the title and the browser ignores the anchor's
// `download` attribute on a cross-origin link — so Chrome asked
// "Download file again?" on episode 2 and nobody could tell which
// episode was downloading.

const SECRET = "test-secret-key-at-least-32-characters-long";
const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

test("downloadDisplayName: movie keeps the bare title", () => {
  assert.equal(downloadDisplayName("Interstellar"), "Interstellar");
});

test("downloadDisplayName: episode gets S01E01, padded", () => {
  assert.equal(downloadDisplayName("VisionQuest", 1, 1), "VisionQuest S01E01");
  assert.equal(downloadDisplayName("VisionQuest", 1, 2), "VisionQuest S01E02");
  assert.equal(downloadDisplayName("VisionQuest", 2, 10), "VisionQuest S02E10");
});

test("downloadDisplayName: illegal filename characters are stripped", () => {
  assert.equal(downloadDisplayName("A/B:C*D?E", 1, 1), "A B C D E S01E01");
});

test("downloadDisplayName: Arabic title keeps its name + episode suffix", () => {
  assert.equal(downloadDisplayName("حب متنكر", 1, 3), "حب متنكر S01E03");
});

test("downloadDisplayName: empty title falls back to filmaty", () => {
  assert.equal(downloadDisplayName(""), "filmaty");
  assert.equal(downloadDisplayName("", 1, 1), "filmaty S01E01");
});

// --- Handler-level: the /api/resolve download token for a TV episode
// must carry the episode name. Fixtures reduced from the live
// VisionQuest diagnosis (see test/resolve-multisite.test.ts).

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const AKWAM_SEARCH_HTML = `
<html><body>
<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/series/5854/visionquest-1">VisionQuest (الموسم 1)</a></h3></div>
</body></html>
`;

const AKWAM_SERIES_PAGE = `
<html><head><title>VisionQuest | اكوام</title></head><body>
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

function installVisionQuestMock() {
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

function mockEnv() {
  const map = new Map<string, string>();
  return {
    env: {
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: SECRET,
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

test("/api/resolve for VisionQuest S1E1 signs the download token as 'VisionQuest S01E01'", async () => {
  const restore = installVisionQuestMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/resolve?type=tv&id=213375&s=1&e=1`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.ok(body.download, "expected a download link");
    const token = new URL(body.download).searchParams.get("t")!;
    const payload = await verifyToken(token, SECRET);
    assert.ok(payload);
    assert.equal(payload!.n, "VisionQuest S01E01");
    // The stream token carries the same name (same token minting).
    const streamToken = new URL(body.stream).searchParams.get("t")!;
    const streamPayload = await verifyToken(streamToken, SECRET);
    assert.equal(streamPayload!.n, "VisionQuest S01E01");
  } finally {
    restore();
  }
});
