import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

test("ad servers: unsandboxed embeds are appended last, labelled, and never auto-picked", () => {
  assert.match(html, /function buildAdServers\(type, id, s = 1, e = 1\)/);
  assert.match(html, /currentServers = currentServers\.concat\(buildAdServers\(/);
  assert.match(html, /isEmbedServer\(currentServers\[i\]\) && !currentServers\[i\]\.ads/);
  assert.match(html, /if \(IN_APP \|\| server\.ads\) videoIframe\.removeAttribute\('sandbox'\)/);
  assert.match(html, /t2\.textContent = '\(ads\)';/);
  assert.match(html, /vidsrc\.to\/embed\/movie\//);
});

test("the default sandboxed servers keep their sandbox", () => {
  assert.match(html, /else videoIframe\.setAttribute\('sandbox', EMBEDWAVE_SANDBOX\)/);
});
