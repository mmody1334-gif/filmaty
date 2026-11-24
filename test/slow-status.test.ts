import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

test("slow resolve shows a still-searching status after 6s and clears the timer", () => {
  assert.match(html, /const slowStatusTimer = setTimeout\(\(\) => \{[\s\S]{0,200}\}, 6000\);/);
  assert.match(html, /clearTimeout\(slowStatusTimer\);/);
});
