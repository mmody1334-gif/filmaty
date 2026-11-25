import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

function mockEnv() {
  const kv = new Map<string, string>();
  return {
    SIGNING_SECRET: "test-secret-key-at-least-32-characters-long",
    BOT_TOKEN: "t",
    TMDB_KEY: "k",
    PUBLIC_BASE: BASE,
    CACHE: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
  } as any;
}

const post = (env: any, body: any) =>
  worker.fetch(
    new Request(`${BASE}/api/profile`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) }),
    env,
    {} as any,
  );
const get = async (env: any, q: string) =>
  (await (await worker.fetch(new Request(`${BASE}/api/profile?${q}`), env, {} as any)).json()) as any;

const prog = {
  "movie:1:0:0": { type: "movie", id: 1, s: 0, e: 0, t: 500, d: 6000, updated: 5000, title: "A", poster: "", kind: "movie" },
};

test("profile without a PIN keeps working and reports hasPin false", async () => {
  const env = mockEnv();
  assert.equal((await post(env, { username: "megoo", progress: prog })).status, 200);
  const r = await get(env, "u=megoo");
  assert.equal(r.hasPin, false);
  assert.ok(r.profile.progress["movie:1:0:0"]);
});

test("setting a PIN keeps existing progress and then locks the profile", async () => {
  const env = mockEnv();
  await post(env, { username: "megoo", progress: prog });
  const set = await post(env, { username: "megoo", setPin: "1234" });
  assert.equal(set.status, 200);
  assert.equal(((await set.json()) as any).hasPin, true);

  const locked = await get(env, "u=megoo");
  assert.equal(locked.locked, true);
  assert.deepEqual(locked.profile.progress, {});

  const wrong = await get(env, "u=megoo&p=9999");
  assert.equal(wrong.locked, true);

  const ok = await get(env, "u=megoo&p=1234");
  assert.equal(ok.hasPin, true);
  assert.ok(ok.profile.progress["movie:1:0:0"], "progress survives PIN creation");
});

test("writes need the PIN once protected", async () => {
  const env = mockEnv();
  await post(env, { username: "megoo", setPin: "4321" });
  assert.equal((await post(env, { username: "megoo", progress: prog })).status, 403);
  assert.equal((await post(env, { username: "megoo", pin: "0000", progress: prog })).status, 403);
  assert.equal((await post(env, { username: "megoo", pin: "4321", progress: prog })).status, 200);
  assert.equal((await post(env, { username: "megoo", setPin: "1111" })).status, 403, "cannot hijack with setPin");
});

test("PIN can be changed when authenticated and must be 4 digits", async () => {
  const env = mockEnv();
  await post(env, { username: "megoo", setPin: "4321" });
  assert.equal((await post(env, { username: "megoo", pin: "4321", newPin: "12" })).status, 400);
  assert.equal((await post(env, { username: "megoo", pin: "4321", newPin: "5555" })).status, 200);
  assert.equal((await get(env, "u=megoo&p=4321")).locked, true);
  assert.equal((await get(env, "u=megoo&p=5555")).locked, undefined);
});

test("brute force is rate limited", async () => {
  const env = mockEnv();
  await post(env, { username: "megoo", setPin: "4321" });
  for (let i = 0; i < 8; i++) await get(env, `u=megoo&p=${1000 + i}`);
  const r = await get(env, "u=megoo&p=4321");
  assert.equal(r.locked, true);
  assert.equal(r.error, "too_many");
});

test("other profiles are not affected by someone else's PIN", async () => {
  const env = mockEnv();
  await post(env, { username: "megoo", setPin: "4321" });
  assert.equal((await post(env, { username: "sara", progress: prog })).status, 200);
  assert.equal((await get(env, "u=sara")).hasPin, false);
});
