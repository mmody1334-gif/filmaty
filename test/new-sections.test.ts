import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage H — New episodes + Coming soon (12): two new home rows from
// TMDB direct (airing today for series, upcoming for movies). A TMDB
// failure degrades to an empty row instead of breaking home. Hermetic:
// reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site home has new-episodes and coming-soon rows", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes("/tv/airing_today?api_key="), "new episodes must come from TMDB airing_today");
  assert.ok(main.includes("/movie/upcoming?api_key="), "coming soon must come from TMDB upcoming");
  assert.ok(main.includes("حلقات جديدة"), "home must have a حلقات جديدة row");
  assert.ok(main.includes("قريبًا"), "home must have a قريبًا row");
  assert.ok(main.includes("newEpisodes"), "home data must carry the new episodes");
  assert.ok(main.includes("upcoming"), "home data must carry the upcoming movies");
});

test("TV home has new-episodes and coming-soon rows", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes("/tv/airing_today?api_key="), "TV new episodes must come from TMDB airing_today");
  assert.ok(tv.includes("/movie/upcoming?api_key="), "TV coming soon must come from TMDB upcoming");
  assert.ok(tv.includes("حلقات جديدة"), "TV home must have a حلقات جديدة row");
  assert.ok(tv.includes("قريبًا"), "TV home must have a قريبًا row");
});
