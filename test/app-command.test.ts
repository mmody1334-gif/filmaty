import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramUpdate } from "../src/telegram/handlers.ts";
import { formatWelcome } from "../src/telegram/views.ts";

// /app command: the bot replies with the Filmaty web-app link and an
// inline keyboard whose buttons open the app (or TV mode) inside
// Telegram via web_app. Hermetic: only the Telegram API is mocked.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(sent: any[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("sendMessage")) {
        sent.push(body);
        return jsonResponse({ ok: true, result: { message_id: 900 + sent.length, ...body } });
      }
      return jsonResponse({ ok: true, result: true });
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

function messageUpdate(text: string) {
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

const APP_URL = "https://mmody1334-gif.github.io/filmaty/";

test("/app replies with the app link and web_app buttons (app + TV)", async () => {
  const sent: any[] = [];
  const restore = installFetchMock(sent);
  const { env } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("/app"), env);
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1, `expected exactly one reply, sent: ${JSON.stringify(sent)}`);
    const msg = sent[0];
    assert.ok((msg.text as string).includes(APP_URL), `reply must contain the app URL, got: ${msg.text}`);
    const buttons = (msg.reply_markup?.inline_keyboard || []).flat();
    const appBtn = buttons.find((b: any) => b.web_app?.url === APP_URL);
    assert.ok(appBtn, `expected a web_app button for the app, got: ${JSON.stringify(buttons)}`);
    const tvBtn = buttons.find((b: any) => b.web_app?.url === `${APP_URL}Tv/`);
    assert.ok(tvBtn, `expected a web_app button for TV mode, got: ${JSON.stringify(buttons)}`);
  } finally {
    restore();
  }
});

test("/app@filmatibot (group form) works the same", async () => {
  const sent: any[] = [];
  const restore = installFetchMock(sent);
  const { env } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("/app@filmatibot"), env);
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.ok((sent[0].text as string).includes(APP_URL));
  } finally {
    restore();
  }
});

test("the /start welcome message lists /app", () => {
  assert.ok(formatWelcome().includes("/app"), "welcome must mention /app");
});
