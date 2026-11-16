import test from "node:test";
import assert from "node:assert/strict";
import {
  handleTelegramUpdate,
  parseStartPayload,
  webAppDataToPayload,
} from "../src/telegram/handlers.ts";

test("parses movie payload m550", () => {
  assert.deepEqual(parseStartPayload("m550"), { type: "movie", tmdbId: 550 });
});

test("parses series payload t1399", () => {
  assert.deepEqual(parseStartPayload("t1399"), {
    type: "tv",
    tmdbId: 1399,
    season: undefined,
    episode: undefined,
  });
});

test("parses series payload with season and episode t1399s1e3", () => {
  assert.deepEqual(parseStartPayload("t1399s1e3"), {
    type: "tv",
    tmdbId: 1399,
    season: 1,
    episode: 3,
  });
});

test("rejects invalid payloads", () => {
  for (const bad of ["m", "m0", "x12", "m12x", "t1399s1", "t1399e3", "", "إنترستيلر", "m-1", "t0"]) {
    assert.equal(parseStartPayload(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("converts web_app_data JSON to short payload strings", () => {
  assert.equal(webAppDataToPayload({ type: "movie", id: 550 }), "m550");
  assert.equal(webAppDataToPayload({ type: "tv", id: 1399, s: 1, e: 3 }), "t1399s1e3");
  assert.equal(webAppDataToPayload({ type: "tv", id: 1399 }), "t1399");
  assert.equal(webAppDataToPayload({ type: "song", id: 1 }), null);
  assert.equal(webAppDataToPayload({ type: "movie", id: "nope" }), null);
  assert.equal(webAppDataToPayload(null), null);
});

// -----------------------------------------------------------------------------
// Integration: /start payloads through handleTelegramUpdate (fetch mocked)
// -----------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(sent: any[], edited: any[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("sendMessage")) {
        sent.push(body);
        return jsonResponse({ ok: true, result: { message_id: 900 + sent.length, ...body } });
      }
      if (url.includes("editMessageText") || url.includes("editMessageCaption")) {
        edited.push(body);
        return jsonResponse({ ok: true, result: { message_id: body.message_id || 999 } });
      }
      return jsonResponse({ ok: true, result: true });
    }

    // TMDB: movie 550 = Fight Club, tv 1399 = Game of Thrones
    if (url.includes("api.themoviedb.org/3/movie/550")) {
      return jsonResponse({ id: 550, title: "Fight Club", original_title: "Fight Club", release_date: "1999-10-15" });
    }
    if (url.includes("api.themoviedb.org/3/tv/1399")) {
      return jsonResponse({ id: 1399, name: "Game of Thrones", original_name: "Game of Thrones", first_air_date: "2011-04-17" });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }

    // All provider sites: empty pages -> no candidates (hermetic, no live net)
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function mockEnv() {
  const map = new Map<string, string>();
  return {
    map,
    env: {
      BOT_TOKEN: "test-bot-token",
      TMDB_KEY: "test-tmdb-key",
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

function messageUpdate(text: string, extra: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 100,
      chat: { id: 12345678 },
      from: { id: 12345678, first_name: "Test" },
      text,
      ...extra,
    },
  };
}

test("/start m550 looks the movie up on TMDB and searches for it", async () => {
  const sent: any[] = [];
  const edited: any[] = [];
  const restore = installFetchMock(sent, edited);
  const { env } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("/start m550"), env);
    assert.equal(res.status, 200);
    const texts = sent.map((m) => m.text as string);
    assert.ok(
      texts.some((t) => t.includes("جاري البحث عن: Fight Club")),
      `expected TMDB title message, sent: ${JSON.stringify(texts)}`,
    );
  } finally {
    restore();
  }
});

test("/start t1399s1e3 searches the series and stores the episode preference", async () => {
  const sent: any[] = [];
  const edited: any[] = [];
  const restore = installFetchMock(sent, edited);
  const { env, map } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("/start t1399s1e3"), env);
    assert.equal(res.status, 200);
    const texts = sent.map((m) => m.text as string);
    assert.ok(
      texts.some((t) => t.includes("جاري البحث عن: Game of Thrones")),
      `expected TMDB title message, sent: ${JSON.stringify(texts)}`,
    );
    const pref = map.get("pref_ep:12345678");
    assert.ok(pref, "expected pref_ep to be stored");
    assert.deepEqual(JSON.parse(pref!), { tmdbId: 1399, season: 1, episode: 3 });
  } finally {
    restore();
  }
});

test("/start with a non-matching payload treats it as a plain search query", async () => {
  const sent: any[] = [];
  const edited: any[] = [];
  const restore = installFetchMock(sent, edited);
  const { env } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("/start hello world"), env);
    assert.equal(res.status, 200);
    const texts = sent.map((m) => m.text as string);
    assert.ok(
      texts.some((t) => t.includes("hello world")),
      `expected plain search for payload, sent: ${JSON.stringify(texts)}`,
    );
  } finally {
    restore();
  }
});

test("/start without payload still shows the welcome message", async () => {
  const sent: any[] = [];
  const edited: any[] = [];
  const restore = installFetchMock(sent, edited);
  const { env } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("/start"), env);
    assert.equal(res.status, 200);
    assert.ok(sent.length >= 1);
    assert.ok(sent[0].text.includes("مرحبًا بك في بوت فيلماتي"));
  } finally {
    restore();
  }
});

test("web_app_data JSON routes through the same payload logic", async () => {
  const sent: any[] = [];
  const edited: any[] = [];
  const restore = installFetchMock(sent, edited);
  const { env } = mockEnv();
  try {
    const update = {
      update_id: 2,
      message: {
        message_id: 101,
        chat: { id: 12345678 },
        from: { id: 12345678, first_name: "Test" },
        web_app_data: { data: JSON.stringify({ type: "tv", id: 1399, s: 1, e: 3 }), button_text: "Send" },
      },
    };
    const res = await handleTelegramUpdate(update, env);
    assert.equal(res.status, 200);
    const texts = sent.map((m) => m.text as string);
    assert.ok(
      texts.some((t) => t.includes("جاري البحث عن: Game of Thrones")),
      `expected TMDB title message via web_app_data, sent: ${JSON.stringify(texts)}`,
    );
  } finally {
    restore();
  }
});
