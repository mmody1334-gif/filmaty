import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage E — Search suggestions + recent searches (6): as the user
// types, the top live results appear under the search box; focusing an
// empty box shows recent searches. Hermetic: reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site shows search suggestions while typing", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="searchSuggest"'), "a suggestions dropdown must exist");
  assert.ok(main.includes("fetchSuggest"), "typing must fetch live suggestions");
  assert.ok(main.includes("renderSuggestItems"), "suggestions must render under the box");
  assert.ok(main.includes("slice(0, 6)"), "suggestions must be capped at 6");
  assert.ok(main.includes("اقتراحات"), "the dropdown must be titled اقتراحات");
});

test("main site keeps recent searches", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("filmaty:recent-searches:v1"), "recent searches must be stored");
  assert.ok(main.includes("saveRecentSearch"), "a completed search must be saved");
  assert.ok(main.includes("readRecentSearches"), "recent searches must be read back");
  assert.ok(main.includes("بحثات أخيرة"), "the dropdown must show recent searches");
});

test("TV page shows search suggestions while typing", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes('id="tvSuggest"'), "a TV suggestions dropdown must exist");
  assert.ok(tv.includes("fetchTvSuggest"), "TV typing must fetch live suggestions");
  assert.ok(tv.includes("renderTvSuggestItems"), "TV suggestions must render under the box");
  assert.ok(tv.includes("slice(0, 6)"), "TV suggestions must be capped at 6");
});

test("TV page keeps recent searches", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("filmaty:recent-searches:v1"), "TV recent searches must use the same key");
  assert.ok(tv.includes("saveTvRecentSearch"), "a completed TV search must be saved");
  assert.ok(tv.includes("readTvRecentSearches"), "TV recent searches must be read back");
  assert.ok(tv.includes("بحثات أخيرة"), "the TV dropdown must show recent searches");
});
