import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage G — Whole-season download (11): a series-only button that
// resolves every episode of the selected season and starts one browser
// download after another, with a per-episode progress list. TV stays
// download-free by design. Hermetic: reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site has a whole-season download flow", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="btnDownloadSeason"'), "a season download button must exist");
  assert.ok(main.includes("تحميل الموسم كامل"), "the button must be labelled تحميل الموسم كامل");
  assert.ok(main.includes('id="seasonDownloadPicker"'), "a season quality picker must exist");
  assert.ok(main.includes('id="seasonDownloadProgress"'), "a season progress list must exist");
  assert.ok(main.includes("downloadSeason"), "a season download routine must exist");
  assert.ok(main.includes("startAnchorDownload"), "downloads must go through one anchor helper");
  assert.ok(main.includes("setTimeout(r, 1500)"), "episodes must be spaced 1.5s apart");
  assert.ok(main.includes("seasonFileName"), "each episode must get its own file name");
  assert.ok(main.includes("downloadFileName"), "single + season downloads share one file-name builder");
  assert.ok(
    main.includes("startAnchorDownload(q, downloadFileName"),
    "the single-episode download must pass its file name (a bare anchor click saves the bare title)",
  );
  assert.ok(!main.includes("startAnchorDownload(q)"), "no download may start without a file name");
});

test("season download is series-only and skips missing episodes", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("mediaType !== 'tv'"), "the season button must hide for movies");
  assert.ok(main.includes("مش متاحة للتحميل"), "an episode with no direct copy must be listed as skipped");
  assert.ok(main.includes("seasonDownloadRunning"), "a season download must not run twice at once");
});

test("TV page still has no download of any kind", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(!tv.includes("downloadQuality"), "TV must not offer direct downloads");
  assert.ok(!tv.includes("downloadSeason"), "TV must not offer season downloads");
  assert.ok(!tv.includes("btnDownloadSeason"), "TV must not have a season download button");
});
