import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramUpdate } from "../src/telegram/handlers.ts";

// Bot search budget (Mohamed, 2026-11-17): the bot returns the 10 closest
// results and the whole search stays within the Worker's ~50 subrequest
// cap. The old flow ran one full 9-provider sweep per engine title, 8 in
// parallel — ~140 subrequests for "Spartacus" — so the search died and the
// bot never answered. The new flow: engine (augmentation off) + ONE
// shared provider sweep + local matching + at most 4 per-title top-ups.
// Hermetic: TMDB is mocked, every provider site returns an empty page, so
// the only attachable candidates come from the embed provider, which
// generates them from the query with no network.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Harness {
  sent: any[];
  edited: any[];
  fetchCount: number;
  mockKv: Map<string, string>;
  restore: () => void;
}

function installHarness(opts: {
  tmdbSearchResults: any[];
  discoverMovies?: any[];
  discoverTv?: any[];
  failFirstSend?: boolean;
}): Harness {
  const sent: any[] = [];
  const edited: any[] = [];
  let fetchCount = 0;
  let failFirstSend = opts.failFirstSend ?? false;
  const mockKv = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("sendMessage")) {
        if (failFirstSend) {
          // The status send itself fails: the search must still answer
          // with a fresh error message instead of going silent.
          failFirstSend = false;
          throw new Error("telegram down");
        }
        sent.push(body);
        return jsonResponse({ ok: true, result: { message_id: 900 + sent.length, ...body } });
      }
      if (url.includes("editMessageText") || url.includes("editMessageCaption")) {
        edited.push(body);
        return jsonResponse({ ok: true, result: { message_id: body.message_id || 999 } });
      }
      if (url.includes("sendPhoto")) {
        sent.push(body);
        return jsonResponse({ ok: true, result: { message_id: 1000, ...body } });
      }
      return jsonResponse({ ok: true, result: true });
    }
    // Non-Telegram fetches count against the Worker's subrequest budget.
    fetchCount++;
    if (url.includes("api.themoviedb.org/3/discover/movie")) {
      return jsonResponse({ results: opts.discoverMovies ?? [] });
    }
    if (url.includes("api.themoviedb.org/3/discover/tv")) {
      return jsonResponse({ results: opts.discoverTv ?? [] });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: opts.tmdbSearchResults });
    }
    // Every provider site: empty page -> no candidates except the embed
    // provider, which generates one from the query with no network.
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return {
    sent,
    edited,
    get fetchCount() {
      return fetchCount;
    },
    mockKv,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function mockEnv(h: Harness): any {
  return {
    BOT_TOKEN: "test-bot-token",
    TMDB_KEY: "test-tmdb-key",
    CACHE: {
      get: async (k: string) => h.mockKv.get(k) || null,
      put: async (k: string, v: string) => {
        h.mockKv.set(k, v);
      },
    },
  };
}

function searchUpdate(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 100,
      chat: { id: 12345678 },
      from: { id: 12345678, first_name: "Test" },
      text,
    },
  };
}

const SPARTACUS_MOVIES = [
  { id: 32528, media_type: "movie", title: "سبارتاكوس", original_title: "Spartacus", release_date: "2004-04-18", vote_average: 6.7, vote_count: 5000, popularity: 40, poster_path: "/sp04.jpg", overview: "" },
  { id: 967, media_type: "movie", title: "سبارتاكوس", original_title: "Spartacus", release_date: "1960-10-07", vote_average: 7.5, vote_count: 4000, popularity: 35, poster_path: "/sp60.jpg", overview: "" },
  { id: 191905, media_type: "movie", title: "سبارتاكوس", original_title: "Spartacus", release_date: "2011-01-01", vote_average: 5.0, vote_count: 100, popularity: 5, poster_path: "/sp11.jpg", overview: "" },
  { id: 570539, media_type: "movie", title: "سبارتاكوس", original_title: "Spartacus", release_date: "2012-01-01", vote_average: 5.0, vote_count: 90, popularity: 5, poster_path: "/sp12.jpg", overview: "" },
  { id: 1098340, media_type: "movie", title: "سبارتاكوس", original_title: "Spartacus", release_date: "2023-01-01", vote_average: 5.0, vote_count: 80, popularity: 5, poster_path: "/sp23.jpg", overview: "" },
  { id: 1758407, media_type: "movie", title: "سبارتاكوس", original_title: "Spartacus", release_date: "", vote_average: 0, vote_count: 10, popularity: 1, poster_path: null, overview: "" },
  { id: 314578, media_type: "movie", title: "سبارتاكوس وكاساندرا", original_title: "Spartacus & Cassandra", release_date: "2014-01-01", vote_average: 6.6, vote_count: 200, popularity: 8, poster_path: "/spc.jpg", overview: "" },
  { id: 1194908, media_type: "movie", title: "سبارتاكوس الصغير", original_title: "Petit Spartacus", release_date: "", vote_average: 7.0, vote_count: 50, popularity: 3, poster_path: "/sps.jpg", overview: "" },
  { id: 246336, media_type: "movie", title: "باليه سبارتاكوس", original_title: "Bolshoi Ballet: Spartacus", release_date: "2013-01-01", vote_average: 0, vote_count: 20, popularity: 2, poster_path: "/spb.jpg", overview: "" },
  { id: 1732112, media_type: "movie", title: "استعادة سبارتاكوس", original_title: "Restoring Spartacus", release_date: "2015-01-01", vote_average: 0, vote_count: 15, popularity: 1, poster_path: "/spr.jpg", overview: "" },
];
const SPARTACUS_TV = [
  { id: 46296, media_type: "tv", name: "سبارتاكوس", original_name: "Spartacus", first_air_date: "2010-01-22", vote_average: 8.0, vote_count: 9000, popularity: 60, poster_path: "/sptv.jpg", overview: "" },
  { id: 49258, media_type: "tv", name: "سبارتاكوس", original_name: "Spartacus", first_air_date: "2004-01-01", vote_average: 7.0, vote_count: 300, popularity: 10, poster_path: "/sptv04.jpg", overview: "" },
];

test("bot /film spartacus returns 10 results within the 50-request budget", async () => {
  const h = installHarness({ tmdbSearchResults: [...SPARTACUS_MOVIES, ...SPARTACUS_TV] });
  try {
    const res = await handleTelegramUpdate(searchUpdate("/film spartacus"), mockEnv(h));
    assert.equal(res.status, 200);

    // Exactly one "searching" status message (no duplicates).
    const searching = h.sent.filter((m) => m.text?.includes("جاري البحث عن"));
    assert.equal(searching.length, 1, `Expected 1 status message, got ${searching.length}`);

    // The results edit carries the count: 10 closest movies.
    const resultEdit = h.edited.find((m) => m.text?.includes("نتائج البحث"));
    assert.ok(resultEdit, `Expected a search-results edit. Edited: ${JSON.stringify(h.edited)}`);
    assert.ok(resultEdit.text.includes("<b>10</b>"), `Expected 10 results, got: ${resultEdit.text}`);

    // The stored search holds all 10 (the keyboard pages 6 at a time).
    const stored = [...h.mockKv.entries()].find(([k]) => k.startsWith("mov_s:"));
    assert.ok(stored, "Expected the search to be stored");
    const storedResults = JSON.parse(stored![1]).results;
    assert.equal(storedResults.length, 10, `Expected 10 stored results, got ${storedResults.length}`);
    const titles = storedResults.map((c: any) => `${c.title} (${c.year})`);
    assert.ok(titles.some((t: string) => t.includes("2004")), `2004 film missing: ${titles.join(" | ")}`);
    assert.ok(titles.some((t: string) => t.includes("1960")), `1960 film missing: ${titles.join(" | ")}`);

    // Budget: engine (2 TMDB) + one shared sweep (9 providers) + 0
    // top-ups (the shared pool already matches all 10) = 11 non-Telegram
    // fetches. Assert with headroom under the ~50 Worker cap.
    assert.ok(h.fetchCount <= 40, `Expected <= 40 provider/TMDB fetches, got ${h.fetchCount}`);
  } finally {
    h.restore();
  }
});

test("bot /film marvel still returns Endgame first (top-up path) within budget", async () => {
  const marvelMovies = [
    { id: 299534, media_type: "movie", title: "المنتقمون: نهاية اللعبة", original_title: "Avengers: Endgame", release_date: "2019-04-24", vote_average: 8.2, vote_count: 24000, popularity: 150, poster_path: "/endgame.jpg", overview: "The Avengers assemble." },
    { id: 1726, media_type: "movie", title: "آيرون مان", original_title: "Iron Man", release_date: "2008-04-30", vote_average: 7.6, vote_count: 26000, popularity: 120, poster_path: "/ironman.jpg", overview: "Tony Stark builds a suit." },
    { id: 299537, media_type: "movie", title: "كابتن مارفل", original_title: "Captain Marvel", release_date: "2019-03-06", vote_average: 6.8, vote_count: 15000, popularity: 90, poster_path: "/captain.jpg", overview: "Carol Danvers." },
  ];
  const marvelSeries = [
    { id: 1402, media_type: "tv", name: "مارفل: ديرديفل", original_name: "Marvel's Daredevil", first_air_date: "2015-04-10", vote_average: 8.2, vote_count: 12000, popularity: 70, poster_path: "/daredevil.jpg", overview: "Blind lawyer." },
  ];
  const h = installHarness({ tmdbSearchResults: [], discoverMovies: marvelMovies, discoverTv: marvelSeries });
  try {
    const res = await handleTelegramUpdate(searchUpdate("/film marvel"), mockEnv(h));
    assert.equal(res.status, 200);
    const resultEdit = h.edited.find((m) => m.text?.includes("نتائج البحث"));
    assert.ok(resultEdit, `Expected a search-results edit. Edited: ${JSON.stringify(h.edited)}`);
    const buttons: string[] = (resultEdit.reply_markup?.inline_keyboard || [])
      .flat()
      .map((b: any) => b.text as string);
    assert.ok(buttons.length >= 2, `Expected at least 2 result buttons, got: ${JSON.stringify(buttons)}`);
    assert.ok(
      buttons[0].includes("المنتقمون: نهاية اللعبة"),
      `Expected Endgame first, got: ${JSON.stringify(buttons)}`,
    );
    assert.ok(h.fetchCount <= 40, `Expected <= 40 provider/TMDB fetches, got ${h.fetchCount}`);
  } finally {
    h.restore();
  }
});

test("a failed status send still delivers the results as a fresh message", async () => {
  const h = installHarness({
    tmdbSearchResults: [...SPARTACUS_MOVIES, ...SPARTACUS_TV],
    failFirstSend: true,
  });
  try {
    // The status send itself fails (Telegram API error — the client
    // swallows it and returns no message id). The search must still
    // deliver: the results go out as a fresh message via safeEdit's
    // fallback, not silence. This is the delivery half of the Spartacus
    // incident — the user saw "searching..." and then nothing at all.
    const res = await handleTelegramUpdate(searchUpdate("/film spartacus"), mockEnv(h));
    assert.equal(res.status, 200);
    const resultsMsg = h.sent.find((m) => m.text?.includes("نتائج البحث عن"));
    assert.ok(resultsMsg, `Expected the results to be delivered anyway. Sent: ${JSON.stringify(h.sent)}`);
    assert.ok(resultsMsg.text.includes("<b>10</b>"), `Expected 10 results, got: ${resultsMsg.text}`);
  } finally {
    h.restore();
  }
});
