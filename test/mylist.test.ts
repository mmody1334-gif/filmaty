import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage B — My list (2+10): save titles to watch later, a row on both
// homes, and an add/remove button in the details on both pages.
// Hermetic: reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site stores My list in localStorage", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("filmaty:mylist:v1"), "My list key must exist");
  for (const fn of ["readMyListStore", "isInMyList", "toggleMyList", "getMyListItems"]) {
    assert.ok(main.includes(`function ${fn}`), `main site must define ${fn}`);
  }
});

test("main site details has a My list toggle and a home row", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="btnMyList"'), "details must have a My list button");
  assert.ok(main.includes("أضف لقائمتي"), "the button must offer adding");
  assert.ok(main.includes("في قائمتي"), "the button must show the saved state");
  assert.ok(main.includes("updateMyListButton"), "the button label must update");
  assert.ok(main.includes("myListSectionHtml(getMyListItems())"), "home must render the My list row");
  assert.ok(main.includes("❤️ قائمتي"), "the row must be titled قائمتي");
});

test("TV page stores My list with the same keys as the main site", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("filmaty:mylist:v1"), "TV My list key must match the main site");
  for (const fn of ["readMyListStore", "isInMyList", "toggleMyList", "getMyListItems"]) {
    assert.ok(tv.includes(`function ${fn}`), `TV page must define ${fn}`);
  }
});

test("TV details has a My list toggle and a home row", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes('id="tvMyList"'), "TV details must have a My list button");
  assert.ok(tv.includes("أضف لقائمتي"), "the TV button must offer adding");
  assert.ok(tv.includes("updateTvMyListButton"), "the TV button label must update");
  assert.ok(tv.includes("tvMyListRowHtml(getMyListItems())"), "TV home must render the My list row");
  assert.ok(tv.includes("❤️ قائمتي"), "the TV row must be titled قائمتي");
});
