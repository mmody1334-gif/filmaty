import test from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../src/engine/token.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";

test("signs and verifies valid token", async () => {
  const payload = {
    u: "https://example.com/video.mp4",
    r: "https://example.com",
    n: "Inception 2010",
    k: "mp4" as const,
    e: Math.floor(Date.now() / 1000) + 3600,
  };

  const token = await signToken(payload, SECRET);
  assert.ok(token.includes("."));

  const verified = await verifyToken(token, SECRET);
  assert.ok(verified !== null);
  if (!verified) throw new Error("Expected token to verify");
  assert.equal(verified.u, payload.u);
  assert.equal(verified.n, payload.n);
  assert.equal(verified.k, "mp4");
});

test("rejects tampered token", async () => {
  const payload = {
    u: "https://example.com/video.mp4",
    n: "Test",
    k: "mp4" as const,
    e: Math.floor(Date.now() / 1000) + 3600,
  };

  const token = await signToken(payload, SECRET);
  const tampered = token.replace(/a/g, "b");
  const result = await verifyToken(tampered, SECRET);
  assert.equal(result, null);
});

test("rejects expired token", async () => {
  const expiredPayload = {
    u: "https://example.com/video.mp4",
    n: "Expired",
    k: "mp4" as const,
    e: Math.floor(Date.now() / 1000) - 100, // In the past
  };

  const token = await signToken(expiredPayload, SECRET);
  const result = await verifyToken(token, SECRET);
  assert.equal(result, null);
});

test("rejects token verified with wrong secret", async () => {
  const payload = {
    u: "https://example.com/video.mp4",
    n: "Test",
    k: "mp4" as const,
    e: Math.floor(Date.now() / 1000) + 3600,
  };

  const token = await signToken(payload, SECRET);
  const result = await verifyToken(token, "wrong-secret-key-different-hash");
  assert.equal(result, null);
});
