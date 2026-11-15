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
