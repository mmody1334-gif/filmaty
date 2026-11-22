import test from "node:test";
import assert from "node:assert/strict";
import { LarozaProvider } from "../src/providers/laroza.ts";

// The rotated site (laroza1.cfd, 2026-11) serves direct downloads as .mkv
// next to file-host aggregator links that also end in .mkv. The extractor
// must accept .mkv and prefer the CDN anchor (class="download-link") over
// aggregator landing pages — the old .mp4-only regex found nothing and the
// main player lost Laroza entirely ("المشغل بيفشل ساعات").
test("laroza download page: extracts the CDN .mkv direct link, not aggregators", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any): Promise<Response> => {
    const url = String(input?.url ?? input);
    if (url.includes("laroza1.cfd/download.php")) {
      return new Response(
        `<a href="https://multiup.io/download/abc/%5BLaroza.Now%5D.film.mkv" target="_blank">MultiUp</a>
         <a href="https://cdn3.okprimeone.site/v/01//00029/xyz_n/film.mkv?t=tok&amp;s=1795313427&amp;e=7200" class="download-link" rel="nofollow">تحميل الفيلم 1080p (1.5 GB)</a>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("laroza1.cfd/play.php")) {
      return new Response("<html><body>no embeds</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response("", { status: 404 });
  };
  try {
    const provider = new LarozaProvider();
    const sources = await (provider as any).extractServersForVid("xyz");
    const direct = sources.find((s: any) => s.kind === "mp4");
    assert.ok(direct, "a direct mp4-kind source must be extracted from the .mkv anchor");
    assert.ok(
      direct.url.startsWith("https://cdn3.okprimeone.site/"),
      `must pick the CDN download-link, got ${direct.url}`,
    );
    assert.ok(!direct.url.includes("multiup.io"), "aggregator landing page must not be picked");
    assert.equal(direct.quality, "1080p");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
