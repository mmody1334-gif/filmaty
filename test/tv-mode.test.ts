import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// TV mode (/Tv): a watch-only page for the TV remote. Entry is ONLY the
// "وضع التلفزيون" button in the main site header — no auto-redirect, no
// pop-ups, no downloads, no bot. Hermetic: reads the files from disk.
// Tests run from the repo root, so paths are relative to process.cwd().
const tvPath = join(process.cwd(), "Tv", "index.html");
const mainPath = join(process.cwd(), "index.html");

test("main site header links to the TV mode at Tv/", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('href="Tv/"'), "header must link to Tv/");
  assert.ok(main.includes("وضع التلفزيون"), "header link must be labelled وضع التلفزيون");
});

test("TV page exists and uses the same Worker API", () => {
  assert.ok(existsSync(tvPath), "Tv/index.html must exist");
  const tv = readFileSync(tvPath, "utf-8");
  for (const endpoint of ["/api/home", "/api/browse", "/api/search", "/api/resolve"]) {
    assert.ok(tv.includes(endpoint), `TV page must call ${endpoint}`);
  }
  assert.ok(tv.includes("<video"), "TV page must have a native <video> player");
  assert.ok(tv.includes("embedwave"), "TV page must offer the sandboxed embed server");
});

test("TV page has remote (D-pad) navigation with a visible focus ring", () => {
  const tv = readFileSync(tvPath, "utf-8");
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"]) {
    assert.ok(tv.includes(key), `TV page must handle ${key}`);
  }
  assert.ok(tv.includes("tv-focus"), "TV page must mark focusable elements with tv-focus");
  assert.ok(tv.includes("#f59e0b"), "TV page focus ring must be the gold colour");
});

test("TV page never opens a pop-up and never auto-redirects", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(!tv.includes("window.open"), "TV page must not call window.open");
  assert.ok(!tv.includes("vidlink"), "TV page must not reference the unsandboxed server");
  assert.ok(!tv.includes("navigator.userAgent"), "TV page must not sniff the user agent");
  assert.ok(!tv.includes("location.replace"), "TV page must not redirect");
  assert.ok(!tv.includes("location.href ="), "TV page must not redirect");
});

test("TV page is watch-only: no download, no bot", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(!tv.includes("bot-code"), "TV page must not offer bot codes");
  assert.ok(!tv.includes("downloadQuality"), "TV page must not offer direct downloads");
  assert.ok(!tv.includes("t.me/"), "TV page must not link out to Telegram");
  assert.ok(tv.includes('href="../"'), "TV page must link back to the main site");
});

test("TV page shows a pairing QR on open and polls for phone commands", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("tvPairOverlay"), "TV page must show the pairing overlay on open");
  assert.ok(tv.includes("tvQrBox"), "TV page must render a QR code for the phone");
  assert.ok(tv.includes("tvSessionCode"), "TV page must show the session code");
  assert.ok(tv.includes("/api/tv-command?session="), "TV page must poll /api/tv-command");
  assert.ok(tv.includes("setInterval(pollRemoteCommands, 10000)"), "TV page must poll every 10s");
  assert.ok(tv.includes("lastAppliedCmdId"), "TV page must dedupe commands by id");
});

test("TV page plays a tapped film fullscreen at the best quality, by itself", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("playBest"), "TV page must have a play-best path");
  assert.ok(tv.includes("requestFullscreen"), "TV page must go fullscreen");
  assert.ok(tv.includes("selectedServerIdx = 0"), "TV page must pick the first (best) server");
  assert.ok(tv.includes("selectedQualityIdx = 0"), "TV page must pick the first (best) quality");
  assert.ok(tv.includes("openDetails("), "TV page must open details");
  assert.ok(tv.includes("autoplay"), "TV page must autoplay a tapped film");
});

const remotePath = join(process.cwd(), "Tv", "remote", "index.html");

test("phone remote page exists and sends picks to /api/tv-command", () => {
  assert.ok(existsSync(remotePath), "Tv/remote/index.html must exist");
  const remote = readFileSync(remotePath, "utf-8");
  assert.ok(remote.includes("/api/tv-command"), "remote page must POST to /api/tv-command");
  assert.ok(remote.includes("action: \"play\"") || remote.includes("action: 'play'") || remote.includes("'play'"), "remote page must send play commands");
  assert.ok(remote.includes("/api/search"), "remote page must search from the phone");
  assert.ok(remote.includes("remoteEpisodes"), "remote page must pick episodes for series");
  assert.ok(!remote.includes("<video"), "remote page must not play video on the phone");
  assert.ok(!remote.includes("window.open"), "remote page must not open pop-ups");
});
