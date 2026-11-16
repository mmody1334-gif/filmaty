import test from "node:test";
import assert from "node:assert/strict";
import { searchPopularIndex } from "../src/engine/search.ts";
import { POPULAR_TITLES } from "../src/data/popular-titles.ts";

// Seed titles that must exist in the baked-in index.
const SEEDS: Array<[number, "movie" | "tv"]> = [
  [85271, "tv"], // WandaVision
  [48866, "tv"], // The 100
  [157336, "movie"], // Interstellar
  [1405, "tv"], // Dexter
  [597, "movie"], // Titanic
  [19995, "movie"], // Avatar
  [76600, "movie"], // Avatar: The Way of Water
];

test("index has at least 100 entries and all 7 seed titles", () => {
  assert.ok(POPULAR_TITLES.length >= 100, `expected >= 100 entries, got ${POPULAR_TITLES.length}`);
  for (const [id, mediaType] of SEEDS) {
    const found = POPULAR_TITLES.find((t) => t.id === id && t.media_type === mediaType);
    assert.ok(found, `seed ${mediaType}:${id} missing from index`);
    assert.ok(found.title_en, `seed ${mediaType}:${id} has no English title`);
    assert.ok(found.title_ar, `seed ${mediaType}:${id} has no Arabic title`);
  }
});

test('searchPopularIndex("vision") returns WandaVision first', () => {
  const results = searchPopularIndex("vision");
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 85271);
  assert.equal(results[0].media_type, "tv");
  // Full display fields so cards render with posters.
  assert.ok(results[0].poster_path, "index hit must carry a poster");
  assert.equal(results[0].original_title, "WandaVision");
});

test('searchPopularIndex("ڤيجن") returns واندافيجن first', () => {
  const results = searchPopularIndex("ڤيجن");
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 85271);
  assert.equal(results[0].media_type, "tv");
});

test('searchPopularIndex("the 100") returns The 100', () => {
  const results = searchPopularIndex("the 100");
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 48866);
  assert.equal(results[0].media_type, "tv");
});

test('searchPopularIndex("interstellar") returns Interstellar', () => {
  const results = searchPopularIndex("interstellar");
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 157336);
  assert.equal(results[0].media_type, "movie");
});

test("searchPopularIndex returns [] for nonsense and empty queries", () => {
  assert.deepEqual(searchPopularIndex("zxqvkj"), []);
  assert.deepEqual(searchPopularIndex(""), []);
  assert.deepEqual(searchPopularIndex("x"), []);
});
