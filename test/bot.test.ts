import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMainMenuKeyboard,
  buildMovieDetailsKeyboard,
  buildSearchResultsKeyboard,
  buildSeriesEpisodesKeyboard,
  buildStreamReadyKeyboard,
  buildTikTokKeyboard,
  buildYouTubeFormatKeyboard,
  buildYouTubePlaylistKeyboard,
} from "../src/telegram/keyboards.ts";
import {
  formatFilmDetails,
  formatSearchResults,
  formatSeriesDetails,
  formatStreamReadyCard,
  formatWelcome,
} from "../src/telegram/views.ts";
import { buildSmartQueries, POPULAR_ALIASES } from "../src/providers/akwam.ts";
import {
  detectSocialPlatform,
  extractFirstUrl,
  parseYouTubePlaylist,
  parseYouTubeVideo,
} from "../src/social/detector.ts";
import type { Candidate, Episode, MediaDetails, SourceLink } from "../src/providers/types.ts";

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
    site: "akwam",
    siteLabel: "أكوام",
    url: `https://akwam.ss/movie/${i}`,
    similarity: 0.8,
  }));

  const kbPage0 = buildSearchResultsKeyboard(mockCandidates, "testKey", 0, 6);
  assert.equal(kbPage0.inline_keyboard.length, 8); // 6 items + 1 nav + 1 search
  const nextBtn = kbPage0.inline_keyboard[6].find((b) => b.text.includes("التالي"));
  assert.ok(nextBtn);

  const kbPage1 = buildSearchResultsKeyboard(mockCandidates, "testKey", 1, 6);
  const prevBtn = kbPage1.inline_keyboard[6].find((b) => b.text.includes("السابق"));
  assert.ok(prevBtn);
});

test("builds movie details keyboard with qualities and sizes", () => {
  const mockSources: SourceLink[] = [
    { name: "1080p", url: "https://example.com/1080", quality: "1080p FHD", kind: "mp4", fileSize: "1.39 GB" },
    { name: "720p", url: "https://example.com/720", quality: "720p HD", kind: "mp4", fileSize: "776.2 MB" },
  ];
  const kb = buildMovieDetailsKeyboard("itemKey1", "searchKey1", mockSources);
  assert.equal(kb.inline_keyboard.length, 3); // 2 qualities + back row
  assert.ok(kb.inline_keyboard[0][0].text.includes("1080p FHD"));
  assert.ok(kb.inline_keyboard[0][0].text.includes("1.39 GB"));
});

test("builds series episodes keyboard (grid of 4)", () => {
  const mockEpisodes: Episode[] = Array.from({ length: 9 }, (_, i) => ({
    episode: i + 1,
    season: 1,
    title: `الحلقة ${i + 1}`,
    url: `https://example.com/ep/${i + 1}`,
  }));

  const kb = buildSeriesEpisodesKeyboard("itemKey2", "searchKey2", mockEpisodes);
  // 9 episodes: row 1 (4), row 2 (4), row 3 (1), row 4 (back row)
  assert.equal(kb.inline_keyboard.length, 4);
  assert.equal(kb.inline_keyboard[0].length, 4);
  assert.equal(kb.inline_keyboard[1].length, 4);
  assert.equal(kb.inline_keyboard[2].length, 1);
});

test("builds stream ready keyboard matching user Image 3 and Image 4", () => {
  const directUrl = "https://s204d1.downet.net/download/123/456/Avengers.Endgame.720p.mp4";
  const kb = buildStreamReadyKeyboard(directUrl, "mov|d|item1", "search1");

  assert.equal(kb.inline_keyboard.length, 3);
  assert.equal(kb.inline_keyboard[0][0].text, "⬇️ Fast Direct Download");
  assert.equal(kb.inline_keyboard[0][0].url, directUrl);
  assert.equal(kb.inline_keyboard[1][0].text, "▶️ Direct Stream");
  assert.equal(kb.inline_keyboard[1][0].url, directUrl);
  assert.equal(kb.inline_keyboard[2][0].text, "🔙 Other Quality");
  assert.equal(kb.inline_keyboard[2][1].text, "🔍 Back to Search");
});

test("formats exact stream ready card", () => {
  const card = formatStreamReadyCard("Avengers Endgame: Encore", "720p HD", "776.2 MB", false);
  assert.ok(card.includes("Ready to stream and download!"));
  assert.ok(card.includes("Avengers Endgame: Encore"));
  assert.ok(card.includes("Quality:</b> 720p HD"));
  assert.ok(card.includes("Size:</b> 776.2 MB"));
  assert.ok(card.includes("Use the direct links below:"));
});

test("expands smart aliases for search queries", () => {
  const q1 = buildSmartQueries("marvel endgame");
  assert.ok(q1.includes("Avengers Endgame"));

  const q2 = buildSmartQueries("مارفل اندجيم");
  assert.ok(q2.includes("Avengers Endgame"));

  const q3 = buildSmartQueries("بريكنج باد");
  assert.ok(q3.includes("Breaking Bad"));
});

test("detects social media URLs accurately", () => {
  const tiktokUrl = "https://www.tiktok.com/@user/video/123456789";
  assert.equal(detectSocialPlatform(tiktokUrl), "tiktok");

  const igUrl = "https://www.instagram.com/reel/Cx123456/";
  assert.equal(detectSocialPlatform(igUrl), "instagram");

  const ytUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(detectSocialPlatform(ytUrl), "youtube");

  const ytPlUrl = "https://www.youtube.com/playlist?list=PL1234567890ABCDEF";
  assert.ok(parseYouTubePlaylist(ytPlUrl));
  assert.equal(parseYouTubePlaylist(ytPlUrl)?.playlistId, "PL1234567890ABCDEF");

  const ytVid = parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ");
  assert.equal(ytVid?.videoId, "dQw4w9WgXcQ");
});
