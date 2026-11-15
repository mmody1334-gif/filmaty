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
      BOT_TOKEN: "9110911940:AAEzBbJK5tED_kamQH0IZxhG0FsqZjJQvns",
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

    // Results must either be sent as photo or edited onto message 999
    const hasPhotoResult = sentMessages.some((m) => m.photo && m.caption?.includes("Avengers Endgame"));
    const hasEditedResult = editedMessages.some((m) => m.text?.includes("نتائج البحث"));

    assert.ok(
      hasPhotoResult || hasEditedResult,
      `Expected search results to be rendered. Sent: ${JSON.stringify(sentMessages)}, Edited: ${JSON.stringify(editedMessages)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
