import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

function mockEnv() {
  const map = new Map<string, string>();
  return {
    map,
    env: {
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: "test-secret-key-at-least-32-characters-long",
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

async function call(env: any, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await worker.fetch(new Request(`${BASE}${path}`, init), env, {} as any);
  return { status: res.status, json: await res.json().catch(() => null) };
}

test("POST /api/tv-command stores a play command and GET returns it", async () => {
  const { env } = mockEnv();
  const posted = await call(env, "POST", "/api/tv-command", {
    session: "Ab3dEf",
    action: "play",
    type: "movie",
    id: 157336,
    cmdId: "cmd-1",
  });
  assert.equal(posted.status, 200);
  assert.equal(posted.json.ok, true);
  assert.equal(posted.json.id, "cmd-1");

  const got = await call(env, "GET", "/api/tv-command?session=Ab3dEf");
  assert.equal(got.status, 200);
  assert.equal(got.json.ok, true);
  assert.equal(got.json.command.action, "play");
  assert.equal(got.json.command.type, "movie");
  assert.equal(got.json.command.tmdbId, 157336);
  assert.equal(got.json.command.id, "cmd-1");
});

test("GET /api/tv-command with no command returns no_command (not an error)", async () => {
  const { env } = mockEnv();
  const got = await call(env, "GET", "/api/tv-command?session=Ab3dEf");
  assert.equal(got.status, 200);
  assert.equal(got.json.ok, false);
  assert.equal(got.json.error, "no_command");
});

test("POST /api/tv-command validates session, action, type and id", async () => {
  const { env } = mockEnv();
  const badSession = await call(env, "POST", "/api/tv-command", { session: "short", action: "play", type: "movie", id: 1 });
  assert.equal(badSession.status, 400);
  const badAction = await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "explode", type: "movie", id: 1 });
  assert.equal(badAction.status, 400);
  const badType = await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "play", type: "book", id: 1 });
  assert.equal(badType.status, 400);
  const badId = await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "play", type: "movie", id: 0 });
  assert.equal(badId.status, 400);
  const badGet = await call(env, "GET", "/api/tv-command?session=!!!");
  assert.equal(badGet.status, 400);
});

test("POST /api/tv-command accepts toggle and close without a title", async () => {
  const { env } = mockEnv();
  const toggle = await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "toggle", cmdId: "cmd-2" });
  assert.equal(toggle.status, 200);
  const got = await call(env, "GET", "/api/tv-command?session=Ab3dEf");
  assert.equal(got.json.command.action, "toggle");
  const close = await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "close", cmdId: "cmd-3" });
  assert.equal(close.status, 200);
});

test("a newer command overwrites the previous one for the same session", async () => {
  const { env } = mockEnv();
  await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "play", type: "movie", id: 157336, cmdId: "cmd-1" });
  await call(env, "POST", "/api/tv-command", { session: "Ab3dEf", action: "play", type: "tv", id: 1405, s: 1, e: 2, cmdId: "cmd-2" });
  const got = await call(env, "GET", "/api/tv-command?session=Ab3dEf");
  assert.equal(got.json.command.id, "cmd-2");
  assert.equal(got.json.command.type, "tv");
  assert.equal(got.json.command.tmdbId, 1405);
  assert.equal(got.json.command.season, 1);
  assert.equal(got.json.command.episode, 2);
});
