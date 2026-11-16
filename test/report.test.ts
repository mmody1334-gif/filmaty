import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage F — Report a problem (7): a button under the player opens a
// problem picker; the report (title, episode, server, quality,
// problem) is prefilled and sent through Telegram's share sheet to
// @filmatibot — no backend. On TV the share link is a QR the phone
// scans. Hermetic: reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site has a report-a-problem flow", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="btnReport"'), "a report button must exist");
  assert.ok(main.includes("بلّغ عن مشكلة"), "the button must be labelled بلّغ عن مشكلة");
  assert.ok(main.includes('id="reportPicker"'), "a problem picker must exist");
  assert.ok(main.includes("buildReportText"), "the report text must be built from the current title");
  assert.ok(main.includes("shareReport"), "the report must go through the Telegram share sheet");
  assert.ok(main.includes("t.me/share/url"), "the share link must be a Telegram share URL");
  assert.ok(main.includes("المشغّل مش شغال"), "the picker must offer the player-broken problem");
});

test("TV page has a report-a-problem flow with a QR", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes('id="tvReport"'), "a TV report button must exist");
  assert.ok(tv.includes('id="tvReportPanel"'), "a TV report panel must exist");
  assert.ok(tv.includes("buildTvReportText"), "the TV report text must be built from the current title");
  assert.ok(tv.includes("showTvReport"), "the TV report must render on demand");
  assert.ok(tv.includes('id="tvReportQr"'), "the TV report must show a QR to scan");
  assert.ok(tv.includes("t.me/share/url"), "the TV share link must be a Telegram share URL");
});
