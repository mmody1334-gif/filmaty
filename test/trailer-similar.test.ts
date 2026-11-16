import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Stage D — Trailer + similar titles (5): a trailer button in the
// details (YouTube embed in the same iframe) and a "similar titles"
// row under it. Hermetic: reads the files from disk.
const mainPath = join(process.cwd(), "index.html");
const tvPath = join(process.cwd(), "Tv", "index.html");

test("main site details has a trailer button and a similar row", () => {
  const main = readFileSync(mainPath, "utf-8");
  assert.ok(main.includes('id="btnTrailer"'), "details must have a trailer button");
  assert.ok(main.includes("مشاهدة التريلر"), "the trailer button must be labelled");
  assert.ok(main.includes('id="similarWrap"'), "details must have a similar-titles section");
  assert.ok(main.includes("أعمال شبه ده"), "the similar section must be titled");
  assert.ok(main.includes("loadTrailerAndSimilar"), "details must fetch trailer + similar from TMDB");
  assert.ok(main.includes("/videos?api_key="), "the trailer must come from TMDB videos");
  assert.ok(main.includes("/similar?api_key="), "similar titles must come from TMDB similar");
  assert.ok(main.includes("youtube.com/embed/"), "the trailer must play in the iframe");
});

test("TV details has a trailer button and a similar row", () => {
  const tv = readFileSync(tvPath, "utf-8");
  assert.ok(tv.includes('id="tvTrailer"'), "TV details must have a trailer button");
  assert.ok(tv.includes('id="tvSimilarWrap"'), "TV details must have a similar-titles section");
  assert.ok(tv.includes("أعمال شبه ده"), "the TV similar section must be titled");
  assert.ok(tv.includes("loadTvTrailerAndSimilar"), "TV details must fetch trailer + similar from TMDB");
  assert.ok(tv.includes("youtube.com/embed/"), "the TV trailer must play in the iframe");
});
