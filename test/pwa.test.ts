import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Stage K — PWA installable (16): manifest-only, no service worker
// (a worker cache would risk serving stale pages after deploys).
// Hermetic: reads the files from disk.
const root = process.cwd();
const mainPath = join(root, "index.html");
const tvPath = join(root, "Tv", "index.html");
const manifestPath = join(root, "manifest.json");
const swPath = join(root, "sw.js");

function pngSize(buf: Buffer): { width: number; height: number } {
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "not a PNG file",
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("manifest.json is a valid standalone PWA manifest", () => {
  assert.ok(existsSync(manifestPath), "manifest.json must exist at the repo root");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.name, "فيلماتي");
  assert.equal(manifest.short_name, "فيلماتي");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.theme_color, "#0b0f19");
  assert.equal(manifest.background_color, "#0b0f19");
  const sizes = (manifest.icons || []).map((i: any) => i.sizes);
  assert.ok(sizes.includes("192x192"), `expected a 192 icon, got: ${JSON.stringify(sizes)}`);
  assert.ok(sizes.includes("512x512"), `expected a 512 icon, got: ${JSON.stringify(sizes)}`);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, "image/png");
    assert.ok(existsSync(join(root, icon.src)), `icon file must exist: ${icon.src}`);
  }
});

test("PWA icons are real PNGs at the declared sizes", () => {
  for (const size of [192, 512]) {
    const buf = readFileSync(join(root, "icons", `icon-${size}.png`));
    assert.deepEqual(pngSize(buf), { width: size, height: size });
  }
});

test("main site links the manifest, theme color, and registers Service Worker", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('rel="manifest" href="manifest.json"'), "main site must link manifest.json");
  assert.ok(main.includes('<meta name="theme-color" content="#0b0f19">'), "main site must set the theme color");
  assert.ok(main.includes('rel="apple-touch-icon"'), "main site must have an apple touch icon");
  assert.ok(existsSync(swPath), "sw.js must exist at repo root");
  assert.ok(main.includes("serviceWorker.register('./sw.js')"), "main site must register sw.js");
});

test("TV page links the manifest (relative to /Tv/) and sets the theme color", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes('rel="manifest" href="../manifest.json"'), "TV page must link ../manifest.json");
  assert.ok(tv.includes('<meta name="theme-color" content="#0b0f19">'), "TV page must set the theme color");
  assert.ok(!tv.includes("serviceWorker"), "no service worker on the TV page either");
});
