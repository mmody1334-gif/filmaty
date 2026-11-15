import test from "node:test";
import assert from "node:assert/strict";
import { AkwamProvider } from "../src/providers/akwam.ts";
import { extractTikTok } from "../src/social/tiktok.ts";
import { fetchYouTubeVideoDetails } from "../src/social/youtube.ts";

test("e2e: Akwam searches marvel and returns valid results", async () => {
  const akwam = new AkwamProvider();
  const results = await akwam.search("marvel endgame");
  assert.ok(Array.isArray(results));
  // In CI or live, if network succeeds:
  if (results.length > 0) {
    const first = results[0];
    assert.ok(first.url.startsWith("https://akwam.ss/"));
    assert.ok(first.title.length > 0);
  }
});

test("e2e: YouTube video details fetches metadata cleanly", async () => {
  const details = await fetchYouTubeVideoDetails("dQw4w9WgXcQ");
  assert.ok(details.title);
  assert.ok(details.videoId === "dQw4w9WgXcQ");
});

test("e2e: NetflixGlobalProvider searches Netflix series and extracts seasons", async () => {
  const { NetflixGlobalProvider } = await import("../src/providers/netflix-global.ts");
  const p = new NetflixGlobalProvider();
  const results = await p.search("Stranger Things", "series");
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  const first = results[0];
  assert.ok(first.title.includes("Stranger Things"));

  const details = await p.getDetails(first);
  assert.ok(details.seasons.length > 0);
  assert.ok(details.seasons[0].episodes.length > 0);

  const sources = await p.getEpisodeSources(details.seasons[0].episodes[0]);
  assert.ok(sources.length >= 2);
  assert.ok(sources[0].url.startsWith("https://"));
});
