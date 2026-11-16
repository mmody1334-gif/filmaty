import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramUpdate } from "../src/telegram/handlers.ts";

// Stage J — bot episode auto-open (15): a /start t<id>s<season>e<episode>
// deep link stores pref_ep:<chatId>; when the user then picks that same
// title from the bot search results, the episode's quality list must open
// directly instead of the season/episode picker. Hermetic: the embed
// provider's getDetails/getEpisodeSources need no network (5 seasons x
// 10 episodes), so the mov|s| pick flow runs entirely offline.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(edited: any[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("editMessageText") || url.includes("editMessageCaption")) {
        edited.push(body);
      }
      return jsonResponse({ ok: true, result: { message_id: 999 } });
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

const EMBED_CANDIDATE = {
  id: "embed:game-of-thrones",
  title: "Game of Thrones",
  kind: "series",
  site: "embed",
  siteLabel: "سيرفرات المشاهدة العالمية",
  url: "https://vidsrc.to/embed/tv?title=Game%20of%20Thrones",
  similarity: 0.8,
  tmdbId: 1399,
};

function callbackUpdate(data: string) {
  return {
    update_id: 10,
    callback_query: {
      id: "cb-1",
      from: { id: 12345678, first_name: "Test" },
      message: { message_id: 999, chat: { id: 12345678 } },
      data,
    },
  };
}

function buttonData(edit: any): string[] {
  return (edit.reply_markup?.inline_keyboard || []).flat().map((b: any) => b.callback_data as string);
}

test("picking the deep-linked title auto-opens the requested episode's qualities", async () => {
  const edited: any[] = [];
  const restore = installFetchMock(edited);
  const { env, map } = mockEnv();
  try {
    map.set(
      "mov_s:TESTKEY",
      JSON.stringify({ query: "Game of Thrones", results: [EMBED_CANDIDATE], kind: "series" }),
    );
    map.set(
      "pref_ep:12345678",
      JSON.stringify({
        tmdbId: 1399,
        season: 1,
        episode: 3,
        title: "Game of Thrones",
        originalTitle: "Game of Thrones",
      }),
    );

    const res = await handleTelegramUpdate(callbackUpdate("mov|s|TESTKEY|0"), env);
    assert.equal(res.status, 200);

    const qualitiesEdit = edited.find((m) => (m.text as string)?.includes("اختر الجودة المطلوبة"));
    assert.ok(qualitiesEdit, `expected the episode qualities to open directly, edited: ${JSON.stringify(edited)}`);
    assert.ok(
      (qualitiesEdit.text as string).includes("الموسم 1 - الحلقة 3"),
      `expected S1E3 in the text, got: ${qualitiesEdit.text}`,
    );
    assert.ok(
      buttonData(qualitiesEdit).some((d) => d.startsWith("mov|eq|")),
      `expected quality buttons, got: ${JSON.stringify(buttonData(qualitiesEdit))}`,
    );
    // The preference is consumed once it fires.
    assert.equal(map.get("pref_ep:12345678"), undefined, "pref_ep must be deleted after auto-open");
  } finally {
    restore();
  }
});

test("without a stored preference the pick shows the normal season picker", async () => {
  const edited: any[] = [];
  const restore = installFetchMock(edited);
  const { env, map } = mockEnv();
  try {
    map.set(
      "mov_s:TESTKEY",
      JSON.stringify({ query: "Game of Thrones", results: [EMBED_CANDIDATE], kind: "series" }),
    );

    const res = await handleTelegramUpdate(callbackUpdate("mov|s|TESTKEY|0"), env);
    assert.equal(res.status, 200);

    assert.ok(
      !edited.some((m) => (m.text as string)?.includes("اختر الجودة المطلوبة")),
      "no direct quality list without a preference",
    );
    const seasonEdit = edited[edited.length - 1];
    assert.ok(
      buttonData(seasonEdit).some((d) => d.startsWith("mov|sn|")),
      `expected season-picker buttons, got: ${JSON.stringify(buttonData(seasonEdit))}`,
    );
  } finally {
    restore();
  }
});

test("a preference for another title does not fire and is not consumed", async () => {
  const edited: any[] = [];
  const restore = installFetchMock(edited);
  const { env, map } = mockEnv();
  try {
    map.set(
      "mov_s:TESTKEY",
      JSON.stringify({ query: "Game of Thrones", results: [EMBED_CANDIDATE], kind: "series" }),
    );
    map.set(
      "pref_ep:12345678",
      JSON.stringify({
        tmdbId: 1405,
        season: 1,
        episode: 1,
        title: "Dexter",
        originalTitle: "Dexter",
      }),
    );

    const res = await handleTelegramUpdate(callbackUpdate("mov|s|TESTKEY|0"), env);
    assert.equal(res.status, 200);

    assert.ok(
      !edited.some((m) => (m.text as string)?.includes("اختر الجودة المطلوبة")),
      "a mismatched preference must not auto-open",
    );
    const seasonEdit = edited[edited.length - 1];
    assert.ok(
      buttonData(seasonEdit).some((d) => d.startsWith("mov|sn|")),
      `expected season-picker buttons, got: ${JSON.stringify(buttonData(seasonEdit))}`,
    );
    assert.ok(map.get("pref_ep:12345678"), "a mismatched preference must stay stored for the right title");
  } finally {
    restore();
  }
});

test("a preference whose episode is missing falls back to the normal picker", async () => {
  const edited: any[] = [];
  const restore = installFetchMock(edited);
  const { env, map } = mockEnv();
  try {
    map.set(
      "mov_s:TESTKEY",
      JSON.stringify({ query: "Game of Thrones", results: [EMBED_CANDIDATE], kind: "series" }),
    );
    // The embed provider has 5 seasons x 10 episodes; S9E1 does not exist.
    map.set(
      "pref_ep:12345678",
      JSON.stringify({
        tmdbId: 1399,
        season: 9,
        episode: 1,
        title: "Game of Thrones",
        originalTitle: "Game of Thrones",
      }),
    );

    const res = await handleTelegramUpdate(callbackUpdate("mov|s|TESTKEY|0"), env);
    assert.equal(res.status, 200);

    assert.ok(
      !edited.some((m) => (m.text as string)?.includes("اختر الجودة المطلوبة")),
      "a missing episode must not auto-open",
    );
    const seasonEdit = edited[edited.length - 1];
    assert.ok(
      buttonData(seasonEdit).some((d) => d.startsWith("mov|sn|")),
      `expected season-picker buttons, got: ${JSON.stringify(buttonData(seasonEdit))}`,
    );
  } finally {
    restore();
  }
});
