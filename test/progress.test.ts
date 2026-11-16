import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage A — Continue watching (1+4+9): resume positions + watched
// marks + per-episode progress on the main site and the TV page, with a
// continue-watching row on both homes. Hermetic: reads the files from
// disk. Tests run from the repo root, so paths are relative to
// process.cwd().
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site stores resume progress in localStorage", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("filmaty:progress:v1"), "progress key must exist");
  assert.ok(main.includes("filmaty:watched:v1"), "watched key must exist");
  for (const fn of ["saveProgressEntry", "getProgress", "markWatchedEntry", "formatTime", "getContinueItems"]) {
    assert.ok(main.includes(`function ${fn}`), `main site must define ${fn}`);
  }
});

test("main site Play button resumes from the saved position", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="btnPlayInAppLabel"'), "Play button label must be updatable");
  assert.ok(main.includes("أكمل من"), "Play button must offer to resume");
  assert.ok(main.includes('id="btnRestartPlay"'), "a restart-from-beginning button must exist");
  assert.ok(main.includes("pendingResume"), "a pending resume position must be tracked");
  assert.ok(main.includes("loadedmetadata"), "resume seek must wait for metadata");
  assert.ok(main.includes("currentTime = Math.min(pendingResume"), "seek must clamp to the duration");
});

test("main site episode buttons show watched marks and progress", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("isWatched('tv'"), "episode buttons must check the watched store");
  assert.ok(main.includes("✓ "), "watched episodes must carry a check mark");
  assert.ok(main.includes("bg-emerald-400"), "partial episodes must show a progress bar");
});

test("main site home has a continue-watching row", () => {
  const main = readFileSync(mainPath, "utf-8");
  for (const fn of ["continueSectionHtml", "continueCardHtml", "openContinueEntry"]) {
    assert.ok(main.includes(`function ${fn}`), `main site must define ${fn}`);
  }
  assert.ok(main.includes("أكمل المشاهدة"), "home must have a continue-watching section");
  assert.ok(main.includes("continueSectionHtml(getContinueItems())"), "the row must render from the progress store");
});

test("main site tracks playback position while watching", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("videoNative.addEventListener('timeupdate'"), "position must be saved while playing");
  assert.ok(main.includes("videoNative.addEventListener('pause'"), "position must be saved on pause");
  assert.ok(main.includes("document.addEventListener('pagehide'"), "position must be saved when the page hides");
  assert.ok(main.includes("videoNative.addEventListener('ended'"), "ending must mark the title watched");
});

test("TV page stores progress with the same keys as the main site", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("filmaty:progress:v1"), "TV progress key must match the main site");
  assert.ok(tv.includes("filmaty:watched:v1"), "TV watched key must match the main site");
  for (const fn of ["saveProgressEntry", "getProgress", "markWatchedEntry", "formatTime", "getContinueItems"]) {
    assert.ok(tv.includes(`function ${fn}`), `TV page must define ${fn}`);
  }
});

test("TV Play button resumes and restart exists", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("updateTvResumeButton"), "TV must update the Play button label");
  assert.ok(tv.includes('id="tvRestart"'), "TV must have a restart-from-beginning button");
  assert.ok(tv.includes("playWithResume"), "TV playback must start from the saved position");
  assert.ok(tv.includes("playFromStart"), "TV must be able to play from the beginning");
  assert.ok(tv.includes("loadedmetadata"), "TV resume seek must wait for metadata");
});

test("TV home has a continue-watching row", () => {
  const tv = readFileSync(tvPath, "utf-8");
  for (const fn of ["tvContinueRowHtml", "bindContinueCards"]) {
    assert.ok(tv.includes(`function ${fn}`), `TV page must define ${fn}`);
  }
  assert.ok(tv.includes("أكمل المشاهدة"), "TV home must have a continue-watching section");
  assert.ok(tv.includes("tvContinueRowHtml(getContinueItems())"), "the TV row must render from the progress store");
  assert.ok(tv.includes("tv-continue-card"), "continue cards must be distinguishable from normal cards");
  assert.ok(tv.includes(".tv-card:not(.tv-continue-card)"), "normal card binding must skip continue cards");
});

test("TV episode buttons show watched marks and progress", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("isWatched('tv'"), "TV episode buttons must check the watched store");
  assert.ok(tv.includes("✓ "), "watched episodes must carry a check mark");
  assert.ok(tv.includes("bg-emerald-400"), "partial episodes must show a progress bar");
});

test("TV tracks playback position while watching", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("tvVideo.addEventListener('timeupdate'"), "TV position must be saved while playing");
  assert.ok(tv.includes("tvVideo.addEventListener('pause'"), "TV position must be saved on pause");
  assert.ok(tv.includes("document.addEventListener('pagehide'"), "TV position must be saved when the page hides");
  assert.ok(tv.includes("tvVideo.addEventListener('ended'"), "TV ending must mark the title watched");
});
