import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanTitle,
  computeSimilarity,
  isRelevant,
  normalizeArabic,
  parseQuality,
  parseSeasonEpisode,
  parseYear,
  toLatinDigits,
} from "../src/engine/normalize.ts";

test("converts Eastern Arabic-Indic numerals to Latin", () => {
  assert.equal(toLatinDigits("فيلم ٢٠٢٦ الموسم ١ الحلقة ١٢"), "فيلم 2026 الموسم 1 الحلقة 12");
});

test("normalizes Arabic letters and diacritics", () => {
  assert.equal(normalizeArabic("إِعْلَانٌ رَسْمِيّ"), "اعلان رسمي");
  assert.equal(normalizeArabic("القاهرة ة ي ى"), "القاهره ه ي ي");
});

test("strips noise and filler words from titles", () => {
  assert.equal(cleanTitle("مشاهدة فيلم Batman Begins 2005 مترجم كامل بجودة عالية HD"), "Batman Begins 2005");
  assert.equal(cleanTitle("مسلسل Breaking Bad الموسم الاول الحلقة 1 مترجمة"), "Breaking Bad");
});

test("extracts season and episode from various formats", () => {
  assert.deepEqual(parseSeasonEpisode("الموسم 2 الحلقة 5"), { season: 2, episode: 5 });
  assert.deepEqual(parseSeasonEpisode("الموسم الثاني الحلقة الخامسة"), { season: 2, episode: 5 });
  assert.deepEqual(parseSeasonEpisode("S03E14"), { season: 3, episode: 14 });
  assert.deepEqual(parseSeasonEpisode("الموسم الاول الحلقة 13 الثالثة عشر"), { season: 1, episode: 13 });
  // Akwam episode links use bare "حلقة N" (no ال) with the season after
  // the show name — the old pattern required "الحلقة" and dropped the
  // episode, so a newest-first page resolved E1 to the last episode's file.
  assert.deepEqual(
    parseSeasonEpisode("حلقة 16 : مسلسل The 100 الموسم السابع The Last War الاخيرة"),
    { season: 7, episode: 16 },
  );
  assert.deepEqual(
    parseSeasonEpisode("حلقة 1 : مسلسل The 100 الموسم السابع From the Ashes"),
    { season: 7, episode: 1 },
  );
  assert.deepEqual(parseSeasonEpisode("حلقة 1: مسلسل Dexter الموسم الاول"), {
    season: 1,
    episode: 1,
  });
  assert.deepEqual(parseSeasonEpisode("موسم 3 حلقة 5"), { season: 3, episode: 5 });
});

test("parses release years reliably", () => {
  assert.equal(parseYear("Spider-Man (2002) 1080p"), 2002);
  assert.equal(parseYear("Avatar: The Way of Water 2022 WEB-DL"), 2022);
});

test("detects media qualities", () => {
  assert.equal(parseQuality("فيلم بدقة 1080p FHD"), "1080p");
  assert.equal(parseQuality("نسخة 720p HD"), "720p");
  assert.equal(parseQuality("جودة 4K UHD"), "4K");
  assert.equal(parseQuality("480p SD"), "480p");
});

test("computes title similarity accurately", () => {
  const sim1 = computeSimilarity("marvel", "Marvels Jessica Jones");
  assert.ok(sim1 > 0.6, `Expected sim > 0.6, got ${sim1}`);

  const sim2 = computeSimilarity("batman", "The Batman 2022");
  assert.ok(sim2 > 0.6, `Expected sim > 0.6, got ${sim2}`);

  const simUnrelated = computeSimilarity("superman", "Barbie");
  assert.ok(simUnrelated < 0.3, `Expected low sim, got ${simUnrelated}`);
});

test("isRelevant verifies token overlap and filters unrelated noise", () => {
  // Positive matches
  assert.ok(isRelevant("مسلسل مفترق طرق الحلقة 14", "مفترق طرق"));
  assert.ok(isRelevant("اللعبة ج5 : الكلاسيكو", "اللعبة"));
  assert.ok(isRelevant("Avengers: Endgame", "marvel endgame"));

  // Negative matches (must reject unrelated trending items)
  assert.ok(!isRelevant("الخليفة 2026", "مفترق طرق"));
  assert.ok(!isRelevant("Perfect Crown 2026", "مفترق طرق"));
  assert.ok(!isRelevant("التمثيلية 2026", "مفترق طرق"));
  assert.ok(!isRelevant("المتشرد 2024", "مفترق طرق"));
});
