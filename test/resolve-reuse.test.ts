import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

test("in-page resolve reuse is age-limited so expired signed links are not replayed", () => {
  assert.match(html, /const RESOLVE_REUSE_OK_MS = 30 \* 60 \* 1000;/);
  assert.match(html, /lastResolved\.data\.ok && Date\.now\(\) - \(lastResolved\.data\._at \|\| 0\) < RESOLVE_REUSE_OK_MS/);
  assert.match(html, /data\._at = Date\.now\(\);/);
});
