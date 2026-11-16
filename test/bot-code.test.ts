import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { generateBotCode, isBotCode, BOT_CODE_ALPHABET } from "../src/engine/botcode.ts";
import { handleTelegramUpdate, webAppDataToPayload } from "../src/telegram/handlers.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";
const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockEnv() {
  const map = new Map<string, string>();
  return {
    map,
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

// Mocked network: TMDB knows Interstellar; the embed provider's vidsrc page
// lists 480p/720p/1080p files; validation probes answer 206 video/mp4.
// Telegram API calls are recorded in `sent`/`videos`/`deleted`.
function installMock(sent: any[], videos: any[], deleted: any[]) {
  const originalFetch = globalThis.fetch;
  const vidsrcHtml = `
    <html><body>
      <video>
        <source src="https://s204d1.downet.net/download/123/Interstellar.480p.mp4">
        <source src="https://s204d1.downet.net/download/123/Interstellar.720p.mp4">
        <source src="https://s204d1.downet.net/download/123/Interstellar.1080p.mp4">
      </video>
    </body></html>
  `;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("sendMessage")) {
        sent.push(body);
        return jsonResponse({ ok: true, result: { message_id: 900 + sent.length, ...body } });
      }
      if (url.includes("sendVideo")) {
        videos.push(body);
        return jsonResponse({ ok: true, result: { message_id: 1001, ...body } });
      }
      if (url.includes("deleteMessage")) {
        deleted.push(body);
        return jsonResponse({ ok: true, result: true });
      }
      return jsonResponse({ ok: true, result: true });
    }
    if (url.includes("api.themoviedb.org/3/movie/157336")) {
      return jsonResponse({
        id: 157336,
        title: "Interstellar",
        original_title: "Interstellar",
        release_date: "2014-11-05",
      });
    }
    if (url.includes("api.themoviedb.org/3/movie/")) {
      return jsonResponse({ status_message: "not found" }, 404);
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("vidsrc.to") || url.includes("vidsrc.me") || url.includes("streamwish.to")) {
      return new Response(vidsrcHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("downet.net")) {
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/441957985",
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

// --- Code format ---

test("generated codes are 6 chars from the unambiguous alphabet", () => {
  const forbidden = new Set(["0", "O", "1", "l", "I"]);
  for (let i = 0; i < 100; i++) {
    const code = generateBotCode();
    assert.equal(code.length, 6);
    for (const ch of code) {
      assert.ok(BOT_CODE_ALPHABET.includes(ch), `char ${ch} not in alphabet`);
      assert.ok(!forbidden.has(ch), `forbidden char ${ch} in code ${code}`);
    }
    assert.ok(isBotCode(code));
  }
});

test("isBotCode rejects lowercase, wrong length and ambiguous chars", () => {
  assert.equal(isBotCode("ABCD23"), true);
  assert.equal(isBotCode("ZZZZ99"), true);
  assert.equal(isBotCode("ABC123"), false); // contains 1
  assert.equal(isBotCode("ABCD0O"), false); // contains 0/O
  assert.equal(isBotCode("ABCDI2"), false); // contains I
  assert.equal(isBotCode("ABCDl2"), false); // contains l
  assert.equal(isBotCode("abcd23"), false); // lowercase
  assert.equal(isBotCode("ABCDE"), false); // 5 chars
  assert.equal(isBotCode("ABCDEFG"), false); // 7 chars
  assert.equal(isBotCode(""), false);
});

test("webAppDataToPayload passes a code through", () => {
  assert.equal(webAppDataToPayload({ code: "ABCD23" }), "ABCD23");
  assert.equal(webAppDataToPayload({ code: "ABC123" }), null);
  assert.equal(webAppDataToPayload({ type: "movie", id: 550 }), "m550");
});

// --- /api/bot-code endpoint ---

async function postBotCode(env: any, body: any) {
  const res = await worker.fetch(
    new Request(`${BASE}/api/bot-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    {} as any,
  );
  return { status: res.status, body: (await res.json()) as any };
}

test("POST /api/bot-code issues a code for a resolvable title+quality", async () => {
  const restore = installMock([], [], []);
  const { env, map } = mockEnv();
  try {
    const { status, body } = await postBotCode(env, { type: "movie", id: 157336, quality: "720p" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(isBotCode(body.code), `code ${body.code} must match the alphabet`);
    const stored = map.get(`botcode:${body.code}`);
    assert.ok(stored, "code must be stored in KV");
    assert.deepEqual(JSON.parse(stored!), {
      type: "movie",
      tmdbId: 157336,
      quality: "720p HD",
    });
  } finally {
    restore();
  }
});

test("POST /api/bot-code without quality defaults to the best quality", async () => {
  const restore = installMock([], [], []);
  const { env, map } = mockEnv();
  try {
    const { status, body } = await postBotCode(env, { type: "movie", id: 157336 });
    assert.equal(status, 200);
    const stored = JSON.parse(map.get(`botcode:${body.code}`)!);
    assert.equal(stored.quality, "1080p FHD");
  } finally {
    restore();
  }
});

test("POST /api/bot-code refuses an unknown quality", async () => {
  const restore = installMock([], [], []);
  const { env } = mockEnv();
  try {
    const { status, body } = await postBotCode(env, { type: "movie", id: 157336, quality: "4K" });
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, "quality_not_found");
  } finally {
    restore();
  }
});

test("POST /api/bot-code refuses an unresolvable title", async () => {
  const restore = installMock([], [], []);
  const { env } = mockEnv();
  try {
    const { status, body } = await postBotCode(env, { type: "movie", id: 999999999 });
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, "not_found");
  } finally {
    restore();
  }
});

test("POST /api/bot-code validates the request body", async () => {
  const restore = installMock([], [], []);
  const { env } = mockEnv();
  try {
    const badType = await postBotCode(env, { type: "song", id: 1 });
    assert.equal(badType.status, 400);
    const badId = await postBotCode(env, { type: "movie", id: -5 });
    assert.equal(badId.status, 400);
  } finally {
    restore();
  }
});

// --- Bot handler: code path ---

test("bot sends the video for a valid code sent as a plain message (no /start)", async () => {
  const sent: any[] = [];
  const videos: any[] = [];
  const deleted: any[] = [];
  const restore = installMock(sent, videos, deleted);
  const { env, map } = mockEnv();
  map.set(
    "botcode:ABCD23",
    JSON.stringify({ type: "movie", tmdbId: 157336, quality: "720p HD" }),
  );
  try {
    const res = await handleTelegramUpdate(messageUpdate("ABCD23"), env);
    assert.equal(res.status, 200);
    assert.equal(videos.length, 1, "expected exactly one sendVideo");
    assert.ok(videos[0].video.includes("720p"), `expected the 720p file, got ${videos[0].video}`);
    assert.ok(videos[0].caption.includes("Interstellar"));
    assert.ok(videos[0].caption.includes("720p HD"));
    // Status message sent, then deleted on success; no search happened.
    assert.ok(sent.some((m) => m.text.includes("جاري إرسال الفيديو")));
    assert.equal(deleted.length, 1);
    assert.ok(!sent.some((m) => m.text?.includes("جاري البحث عن")));
  } finally {
    restore();
  }
});

test("bot accepts the code as a /start payload too", async () => {
  const sent: any[] = [];
  const videos: any[] = [];
  const deleted: any[] = [];
  const restore = installMock(sent, videos, deleted);
  const { env, map } = mockEnv();
  map.set(
    "botcode:ABCD23",
    JSON.stringify({ type: "movie", tmdbId: 157336, quality: "1080p FHD" }),
  );
  try {
    const res = await handleTelegramUpdate(messageUpdate("/start ABCD23"), env);
    assert.equal(res.status, 200);
    assert.equal(videos.length, 1);
    assert.ok(videos[0].video.includes("1080p"));
  } finally {
    restore();
  }
});

test("bot replies with the error for an unknown/expired code and does nothing else", async () => {
  const sent: any[] = [];
  const videos: any[] = [];
  const deleted: any[] = [];
  const restore = installMock(sent, videos, deleted);
  const { env } = mockEnv();
  try {
    const res = await handleTelegramUpdate(messageUpdate("ZZZZ99"), env);
    assert.equal(res.status, 200);
    assert.equal(videos.length, 0);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes("الكود غير صحيح أو انتهت صلاحيته"));
  } finally {
    restore();
  }
});
