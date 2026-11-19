import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramUpdate } from "../src/telegram/handlers.ts";

test("handleTelegramUpdate processes /film marvel endgame cleanly without throwing", async () => {
  const sentMessages: any[] = [];
  const editedMessages: any[] = [];

  // Mock global fetch for Telegram API
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(input);

    if (urlStr.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (urlStr.includes("sendMessage")) {
        sentMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 999, ...body } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("editMessageText") || urlStr.includes("editMessageCaption")) {
        editedMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: body.message_id || 999, ...body } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("sendPhoto")) {
        sentMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1000, ...body } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pass through actual provider requests
    return originalFetch(input, init);
  };

  try {
    const mockKv = new Map<string, string>();
    const mockEnv: any = {
      BOT_TOKEN: "test-bot-token",
      CACHE: {
        get: async (k: string) => mockKv.get(k) || null,
        put: async (k: string, v: string) => { mockKv.set(k, v); },
      },
    };

    const update = {
      update_id: 12345,
      message: {
        message_id: 100,
        chat: { id: 12345678 },
        from: { id: 12345678, first_name: "Test" },
        text: "/film marvel endgame",
      },
    };

    const res = await handleTelegramUpdate(update, mockEnv);
    assert.equal(res.status, 200);

    // Initial status message must be sent
    assert.ok(sentMessages.length >= 1, "Status message should be sent");
    const statusMsg = sentMessages[0];
    assert.ok(statusMsg.text.includes("جاري البحث عن"), "First message should be searching indicator");

    // Results must either be sent as photo or edited onto message 999.
    // The unified engine (stage 2) displays the TMDB Arabic title, so
    // the title lives on the result BUTTON ("المنتقمون: نهاية اللعبة"),
    // not in the photo caption (which only carries the count).
    const hasPhotoResult = sentMessages.some((m) => {
      if (!m.photo) return false;
      const buttons = (m.reply_markup?.inline_keyboard || [])
        .flat()
        .map((b: any) => b.text as string);
      const allText = `${m.caption || ""} ${buttons.join(" ")}`;
      return allText.includes("Avengers Endgame") || allText.includes("المنتقمون: نهاية اللعبة");
    });
    const hasEditedResult = editedMessages.some((m) => m.text?.includes("نتائج البحث"));

    assert.ok(
      hasPhotoResult || hasEditedResult,
      `Expected search results to be rendered. Sent: ${JSON.stringify(sentMessages)}, Edited: ${JSON.stringify(editedMessages)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Search rebuild, stage 2: the bot's /film search must use the same
// unified engine as the site (brands + famous-titles index + TMDB), not
// the raw provider search. Hermetic: TMDB discover/search are mocked;
// every provider site returns empty HTML, so the only attachable
// candidates come from the embed provider, which generates them from
// the query with no network.
test("bot /film marvel uses the unified engine: Endgame first, same as the site", async () => {
  const sentMessages: any[] = [];
  const editedMessages: any[] = [];

  const marvelMovies = [
    { id: 299534, media_type: "movie", title: "المنتقمون: نهاية اللعبة", original_title: "Avengers: Endgame", release_date: "2019-04-24", vote_average: 8.2, vote_count: 24000, popularity: 150, poster_path: "/endgame.jpg", overview: "The Avengers assemble." },
    { id: 1726, media_type: "movie", title: "آيرون مان", original_title: "Iron Man", release_date: "2008-04-30", vote_average: 7.6, vote_count: 26000, popularity: 120, poster_path: "/ironman.jpg", overview: "Tony Stark builds a suit." },
    { id: 299537, media_type: "movie", title: "كابتن مارفل", original_title: "Captain Marvel", release_date: "2019-03-06", vote_average: 6.8, vote_count: 15000, popularity: 90, poster_path: "/captain.jpg", overview: "Carol Danvers." },
  ];
  const marvelSeries = [
    { id: 1402, media_type: "tv", name: "مارفل: ديرديفل", original_name: "Marvel's Daredevil", first_air_date: "2015-04-10", vote_average: 8.2, vote_count: 12000, popularity: 70, poster_path: "/daredevil.jpg", overview: "Blind lawyer." },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(input);
    if (urlStr.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (urlStr.includes("sendMessage")) {
        sentMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 999, ...body } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("editMessageText") || urlStr.includes("editMessageCaption")) {
        editedMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: body.message_id || 999, ...body } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("sendPhoto")) {
        sentMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1000, ...body } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("api.themoviedb.org/3/discover/movie")) {
      return new Response(JSON.stringify({ results: marvelMovies }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("api.themoviedb.org/3/discover/tv")) {
      return new Response(JSON.stringify({ results: marvelSeries }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("api.themoviedb.org/3/search/multi")) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (urlStr.includes("api.themoviedb.org")) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Every provider site: empty page -> no candidates except the embed
    // provider, which generates one from the query with no network.
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const mockKv = new Map<string, string>();
    const mockEnv: any = {
      BOT_TOKEN: "test-bot-token",
      TMDB_KEY: "test-tmdb-key",
      CACHE: {
        get: async (k: string) => mockKv.get(k) || null,
        put: async (k: string, v: string) => { mockKv.set(k, v); },
      },
    };

    const update = {
      update_id: 12346,
      message: {
        message_id: 101,
        chat: { id: 12345678 },
        from: { id: 12345678, first_name: "Test" },
        text: "/film marvel",
      },
    };

    const res = await handleTelegramUpdate(update, mockEnv);
    assert.equal(res.status, 200);

    // Results are edited onto the status message with a keyboard whose
    // buttons carry the titles in engine order.
    const resultEdit = editedMessages.find((m) => m.text?.includes("نتائج البحث"));
    assert.ok(resultEdit, `Expected a search-results edit. Edited: ${JSON.stringify(editedMessages)}`);
    const buttons: string[] = (resultEdit.reply_markup?.inline_keyboard || [])
      .flat()
      .map((b: any) => b.text as string);
    assert.ok(buttons.length >= 2, `Expected at least 2 result buttons, got: ${JSON.stringify(buttons)}`);
    assert.ok(
      buttons[0].includes("المنتقمون: نهاية اللعبة"),
      `First button must be Endgame (engine order), got: ${JSON.stringify(buttons)}`,
    );
    assert.ok(
      buttons.some((b) => b.includes("آيرون مان")),
      `Iron Man must be in the results, got: ${JSON.stringify(buttons)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
