import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, probeLink } from "../src/engine/probe.ts";

test("formats file sizes cleanly", () => {
  assert.equal(formatBytes(1024 * 1024 * 350), "350.0 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), "2.50 GB");
  assert.equal(formatBytes(1024 * 500), "500 KB");
  assert.equal(formatBytes(0), undefined);
});

test("evaluates known embed hosts without crashing", async () => {
  const result = await probeLink("https://mixdrop.top/e/123456", undefined, 1000);
  assert.equal(result.kind, "embed");
  assert.ok(result.host.includes("mixdrop"));
});
