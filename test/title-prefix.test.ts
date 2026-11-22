import test from "node:test";
import assert from "node:assert/strict";
import { resolveServersByTmdb, prefixTitleDigitsOk } from "../src/engine/resolve.ts";

// Reverse-prefix title matching: providers often list a title WITHOUT the
// subtitle TMDB carries ("ولاد رزق 3 2024" vs TMDB "ولاد رزق 3: القاضية").
// The short name is accepted only with identity proof — movies: same part
// digits + same release year; series: the provider page itself contains the
// full title. The historical wrong-title bugs (Dexter original resolved for
// a Dexter: Resurrection request, ولاد رزق part 1 for part 3) must stay
// rejected. Approved by the user 2026-11-22.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

function mockEnv() {
  return {
    TMDB_KEY: "test-tmdb-key",
    CACHE: { get: async () => null, put: async () => {}, delete: async () => {} },
  } as any;
}

test("prefixTitleDigitsOk: prefix + equal part digits only", () => {
  assert.ok(prefixTitleDigitsOk("ولاد رزق 3 2024", "ولاد رزق 3: القاضية"));
  assert.ok(!prefixTitleDigitsOk("ولاد رزق", "ولاد رزق 3: القاضية"), "part 1 must not match part 3");
  assert.ok(!prefixTitleDigitsOk("ولاد رزق 2", "ولاد رزق 3: القاضية"));
  assert.ok(prefixTitleDigitsOk("Dexter", "Dexter: Resurrection"), "digits pass; the year/page gates reject this");
  assert.ok(!prefixTitleDigitsOk("Dexter: Resurrection", "Dexter"), "wrong direction stays rejected");
  assert.ok(!prefixTitleDigitsOk("Prestige", "The Prestige"));
});

const RIZQ_DL_PAGE = `
<a href="https://multiup.io/download/abc/film.mkv">MultiUp</a>
<a href="https://cdn3.okprimeone.site/v/01/rizq3_n/welad-rizk-3.mkv?t=tok&amp;e=7200" class="download-link">تحميل 1080p (1.5 GB)</a>
`;

function rizqFetch(part1Only: boolean) {
  return async (input: any): Promise<Response> => {
    const url = String(input?.url ?? input);
    if (url.includes("api.themoviedb.org/3/movie/629040")) {
      return jsonResponse({
        id: 629040,
        title: "ولاد رزق 3: القاضية",
        original_title: "ولاد رزق 3: القاضية",
        release_date: "2024-06-05",
      });
    }
    if (url.includes("laroza1.cfd/search.php")) {
      const rows = part1Only
        ? '<a href="https://laroza1.cfd/video.php?vid=wrz1" title="فيلم ولاد رزق 1 الجزء 2015">x</a>'
        : '<a href="https://laroza1.cfd/video.php?vid=wrz1" title="فيلم ولاد رزق 1 الجزء 2015">x</a>' +
          '<a href="https://laroza1.cfd/video.php?vid=wrz3" title="فيلم ولاد رزق 3 2024">x</a>';
      return html(rows);
    }
    if (url.includes("laroza1.cfd/download.php?vid=wrz3")) return html(RIZQ_DL_PAGE);
    if (url.includes("laroza1.cfd/download.php?vid=wrz1")) {
      return html('<a href="https://cdn9.okprimeone.site/v/01/rizq1_n/welad-rizk-1.mp4" class="download-link">720p</a>');
    }
    if (url.includes("laroza1.cfd/play.php") || url.includes("laroza1.cfd/video.php")) return html("<html></html>");
    if (url.includes("okprimeone.site")) {
      return new Response("x", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1000", "Content-Length": "1" },
      });
    }
    return html("<html></html>", 404);
  };
}

test("movie: provider's short title accepted when part digits and year match (ولاد رزق 3)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rizqFetch(false) as any;
  try {
    const r = await resolveServersByTmdb(mockEnv(), "movie", 629040);
    assert.ok(r, "resolve must succeed via the prefix-accepted candidate");
    const laroza = r!.servers.find((s) => s.name === "لاروزا");
    assert.ok(laroza, "the Laroza server must be present");
    assert.ok(
      laroza!.qualities[0].directVideoUrl.includes("rizk-3"),
      `must be the part-3 file, got ${laroza!.qualities[0].directVideoUrl}`,
    );
    assert.ok(!laroza!.qualities[0].directVideoUrl.includes("rizk-1"), "part 1 must never be served");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("movie: part-1-only candidate is still rejected for a part-3 request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = rizqFetch(true) as any;
  try {
    const r = await resolveServersByTmdb(mockEnv(), "movie", 629040);
    assert.equal(r, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("movie: year mismatch keeps the short title rejected (Dexter for Dexter: Resurrection)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any): Promise<Response> => {
    const url = String(input?.url ?? input);
    if (url.includes("api.themoviedb.org/3/movie/1235084")) {
      return jsonResponse({
        id: 1235084,
        title: "Dexter: Resurrection",
        original_title: "Dexter: Resurrection",
        release_date: "2025-07-11",
      });
    }
    if (url.includes("laroza1.cfd/search.php")) {
      return html('<a href="https://laroza1.cfd/video.php?vid=dex06" title="فيلم Dexter 2006">x</a>');
    }
    if (url.includes("laroza1.cfd/download.php")) {
      return html('<a href="https://cdn3.okprimeone.site/v/01/dex/dexter-2006.mp4" class="download-link">720p</a>');
    }
    if (url.includes("okprimeone.site")) {
      return new Response("x", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1000" } });
    }
    return html("<html></html>", 404);
  }) as any;
  try {
    const r = await resolveServersByTmdb(mockEnv(), "movie", 1235084);
    assert.equal(r, null, "the 2006 Dexter must not resolve for the 2025 request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function dexterSeriesFetch(pageHasFullTitle: boolean) {
  return async (input: any): Promise<Response> => {
    const url = String(input?.url ?? input);
    if (url.includes("api.themoviedb.org/3/tv/259909")) {
      return jsonResponse({
        id: 259909,
        name: "Dexter: Resurrection",
        original_name: "Dexter: Resurrection",
        first_air_date: "2025-07-11",
      });
    }
    if (url.includes("laroza1.cfd/search.php")) {
      return html('<a href="https://laroza1.cfd/video.php?vid=dex1" title="مسلسل Dexter">x</a>');
    }
    if (url.includes("laroza1.cfd/video.php?vid=dex1")) {
      // The provider page itself proves (or disproves) the full title.
      return html(
        pageHasFullTitle
          ? "<html><head><title>مسلسل Dexter: Resurrection الحلقة 1</title></head><body></body></html>"
          : "<html><head><title>مسلسل Dexter الحلقة 1</title></head><body></body></html>",
      );
    }
    if (url.includes("laroza1.cfd/download.php")) {
      return html('<a href="https://cdn3.okprimeone.site/v/01/dexr/dexter-resurrection-s01e01.mkv?t=tok" class="download-link">720p</a>');
    }
    if (url.includes("laroza1.cfd/play.php")) return html("<html></html>");
    if (url.includes("okprimeone.site")) {
      return new Response("x", { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1000" } });
    }
    return html("<html></html>", 404);
  };
}

test("series: short title accepted when the provider page contains the full title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = dexterSeriesFetch(true) as any;
  try {
    const r = await resolveServersByTmdb(mockEnv(), "tv", 259909, 1, 1);
    assert.ok(r, "page-confirmed prefix candidate must resolve");
    assert.ok(
      r!.servers[0].qualities[0].directVideoUrl.includes("dexter-resurrection"),
      `got ${r!.servers[0].qualities[0].directVideoUrl}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("series: short title rejected when the provider page lacks the full title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = dexterSeriesFetch(false) as any;
  try {
    const r = await resolveServersByTmdb(mockEnv(), "tv", 259909, 1, 1);
    assert.equal(r, null, "unconfirmed prefix candidate must stay rejected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
