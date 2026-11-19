import { test } from "node:test";
import assert from "node:assert/strict";
import { attachEnTitles, enTitleFromTranslations } from "../src/engine/en-titles.ts";

test("attachEnTitles maps English names by type:id and falls back to English originals", () => {
  const ar = [
    { id: 1, media_type: "tv", name: "لعبة الحبار", original_language: "ko" },
    { id: 2, media_type: "movie", title: "بين النجوم", original_language: "en", original_title: "Interstellar" },
  ];
  const en = [{ id: 1, media_type: "tv", name: "Squid Game" }];
  const out = attachEnTitles(ar, en) as any[];
  assert.equal(out[0].title_en, "Squid Game");
  assert.equal(out[1].title_en, "Interstellar");
});

test("enTitleFromTranslations prefers en-US", () => {
  const d = { translations: { translations: [
    { iso_639_1: "en", iso_3166_1: "GB", data: { name: "UK name" } },
    { iso_639_1: "en", iso_3166_1: "US", data: { name: "US name" } },
  ] } };
  assert.equal(enTitleFromTranslations(d), "US name");
});
