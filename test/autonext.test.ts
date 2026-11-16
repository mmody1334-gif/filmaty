import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage C — Auto-next episode (3): when a series episode ends on the
// native player, the next one starts after a 5s countdown the user can
// cancel or skip. Embedwave cannot report "ended", so it never
// auto-advances. Hermetic: reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site auto-advances to the next episode after a countdown", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="autoNextBar"'), "a countdown bar must exist");
  assert.ok(main.includes('id="btnAutoNextNow"'), "a play-now button must exist");
  assert.ok(main.includes('id="btnAutoNextCancel"'), "a cancel button must exist");
  for (const fn of ["armAutoNext", "clearAutoNext"]) {
    assert.ok(main.includes(`function ${fn}`), `main site must define ${fn}`);
  }
  assert.ok(main.includes("الحلقة التالية"), "the countdown must name the next episode");
  assert.ok(main.includes("currentSeasonEpisodeCount"), "the season episode count must be tracked");
});

test("main site arms auto-next only when an episode ends natively", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("armAutoNext()"), "the ended handler must arm auto-next");
  assert.ok(main.includes("if (!nativeActive) return"), "auto-next must require the native player");
  assert.ok(main.includes("selectedEpisode >= currentSeasonEpisodeCount"), "the last episode must not auto-advance");
  assert.ok(main.includes("clearAutoNext()"), "switching episodes or servers must cancel the countdown");
});

test("TV page auto-advances to the next episode after a countdown", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes('id="tvAutoNextBar"'), "a TV countdown bar must exist");
  assert.ok(tv.includes('id="tvAutoNextNow"'), "a TV play-now button must exist");
  assert.ok(tv.includes('id="tvAutoNextCancel"'), "a TV cancel button must exist");
  for (const fn of ["armTvAutoNext", "clearTvAutoNext"]) {
    assert.ok(tv.includes(`function ${fn}`), `TV page must define ${fn}`);
  }
  assert.ok(tv.includes("الحلقة التالية"), "the TV countdown must name the next episode");
  assert.ok(tv.includes("armTvAutoNext()"), "the TV ended handler must arm auto-next");
});
