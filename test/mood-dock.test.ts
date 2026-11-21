import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSE_GENRES, BROWSE_SORTS } from "../src/engine/browse.ts";

// Mood dock (#24): one-tap mood chips in the header. Each chip is a
// preset browse (type + genre + sort) rendered through the existing
// grid via loadBrowse -> /api/browse, so no new Worker endpoint, no
// new KV writes, and genres stay inside the server allowlist.
// Hermetic: reads index.html from disk.
const main = readFileSync(join(process.cwd(), "index.html"), "utf-8");

const CHIP_RE =
  /class="mood-chip [^"]*" data-type="(movie|tv)" data-genre="(\d+)" data-sort="(popular|top_rated|newest)"/g;

test("home header has a mood dock with one-tap mood chips", () => {
  assert.ok(main.includes('id="moodDock"'), "mood dock row must exist in the header");
  const chips = [...main.matchAll(CHIP_RE)];
  assert.ok(chips.length >= 6, `expected at least 6 mood chips, found ${chips.length}`);
  for (const [, type, genre, sort] of chips) {
    assert.ok(type === "movie" || type === "tv", `chip type ${type} must be movie|tv`);
    assert.ok(
      (BROWSE_GENRES as readonly string[]).includes(genre),
      `chip genre ${genre} must be in the /api/browse BROWSE_GENRES allowlist`,
    );
    assert.ok(
      (BROWSE_SORTS as readonly string[]).includes(sort),
      `chip sort ${sort} must be in BROWSE_SORTS`,
    );
  }
});

test("mood chips reuse the existing browse grid (no new endpoints, no KV)", () => {
  assert.ok(main.includes("document.querySelectorAll('.mood-chip')"), "mood chips must be bound");
  assert.ok(
    /querySelectorAll\('\.mood-chip'\)[\s\S]{0,700}loadBrowse\(/.test(main),
    "mood chip clicks must open the grid through loadBrowse",
  );
  assert.ok(!main.includes("/api/mood"), "moods must reuse /api/browse, not a new Worker endpoint");
});

test("mood dock random chip opens the existing سهرة modal", () => {
  assert.ok(main.includes('id="moodDockRandom"'), "random pick chip must exist");
  assert.ok(
    /moodDockRandom[\s\S]{0,300}btnMoodPicker/.test(main),
    "random chip must forward to the existing mood modal button",
  );
});

test("selecting a category pill clears the active mood chip highlight", () => {
  assert.ok(main.includes("function clearActiveMoodChips()"), "mood chip reset helper must exist");
  assert.ok(
    /function clearActiveFilters\(\) \{[\s\S]{0,500}clearActiveMoodChips\(\);/.test(main),
    "clearActiveFilters must also reset mood chips",
  );
});
