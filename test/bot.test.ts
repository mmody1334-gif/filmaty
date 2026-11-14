import test from "node:test";
import assert from "node:assert/strict";
import { buildEpisodesKeyboard, buildMainMenuKeyboard, buildQualitiesKeyboard, buildSearchResultsKeyboard, buildSeasonsKeyboard } from "../src/telegram/keyboards.ts";
import { formatFilmDetails, formatSeriesDetails, formatWelcome } from "../src/telegram/views.ts";
import type { Candidate, MediaDetails } from "../src/providers/types.ts";

test("builds main menu keyboard", () => {
  const kb = buildMainMenuKeyboard();
  assert.equal(kb.inline_keyboard.length, 2);
  assert.equal(kb.inline_keyboard[0][0].text.includes("/film"), true);
  assert.equal(kb.inline_keyboard[0][1].text.includes("/series"), true);
});

test("builds search results keyboard with pagination", () => {
  const mockCandidates: Candidate[] = Array.from({ length: 15 }, (_, i) => ({
    id: `test:${i}`,
    title: `Movie ${i}`,
    kind: "movie" as const,
    site: "laroza",
    siteLabel: "لاروزا",
    url: `https://example.com/${i}`,
    similarity: 0.8,
  }));

  const kbPage0 = buildSearchResultsKeyboard(mockCandidates, 0, 6);
  assert.equal(kbPage0.inline_keyboard.length, 8); // 6 items + 1 nav + 1 search
  const nextBtn = kbPage0.inline_keyboard[6].find((b) => b.text.includes("التالي"));
  assert.ok(nextBtn);

  const kbPage1 = buildSearchResultsKeyboard(mockCandidates, 1, 6);
  const prevBtn = kbPage1.inline_keyboard[6].find((b) => b.text.includes("السابق"));
  assert.ok(prevBtn);
});

test("builds seasons and episodes keyboards", () => {
  const seasonsKb = buildSeasonsKeyboard([
    { season: 1, episodes: [{ season: 1, episode: 1, title: "Ep 1", url: "" }] },
    { season: 2, episodes: [{ season: 2, episode: 1, title: "Ep 1", url: "" }] },
  ]);
  assert.ok(seasonsKb.inline_keyboard.length >= 2);

  const epKb = buildEpisodesKeyboard(1, [
    { season: 1, episode: 1, title: "Ep 1", url: "" },
    { season: 1, episode: 2, title: "Ep 2", url: "" },
    { season: 1, episode: 3, title: "Ep 3", url: "" },
  ]);
  assert.equal(epKb.inline_keyboard[0].length, 3);
});

test("builds qualities keyboard", () => {
  const qKb = buildQualitiesKeyboard();
  assert.ok(qKb.inline_keyboard.some((row) => row.some((b) => b.callback_data === "ql:1080p")));
  assert.ok(qKb.inline_keyboard.some((row) => row.some((b) => b.callback_data === "ql:720p")));
});

test("formats views cleanly", () => {
  const welcome = formatWelcome();
  assert.ok(welcome.includes("فيلماتي"));
  assert.ok(welcome.includes("/film"));
  assert.ok(welcome.includes("/series"));

  const mockDetails: MediaDetails = {
    candidate: { id: "1", title: "Inception", kind: "movie", site: "laroza", siteLabel: "لاروزا", url: "" },
    title: "Inception",
    year: 2010,
    kind: "movie",
    seasons: [],
    sources: [],
  };
  const filmView = formatFilmDetails(mockDetails);
  assert.ok(filmView.includes("Inception"));
  assert.ok(filmView.includes("2010"));
});
