// EgyDead provider — hermetic tests with a mocked fetch.
// The live site was DOWN while this provider was written (2026-11-17
// 23:39: tv10 times out, a1.egydead.media answers Cloudflare 522), so
// these fixtures model the WordPress search/detail pages described by
// the public Nuvio plugin (SafaaSalam/Arabic-Nuvio providers/egydead.js):
// search at /?s={query}, title pages linked from <a> tags, episode links
// whose text carries "الحلقة N". Re-verify against the live site when it
// comes back.
import test from "node:test";
import assert from "node:assert/strict";
import { EgyDeadProvider } from "../src/providers/egydead.ts";
import { ALL_PROVIDERS } from "../src/providers/index.ts";

const SEARCH_HTML = `
<html><head><title>نتائج البحث عن Spartacus</title></head><body>
<nav><a href="https://tv10.egydead.live/">الرئيسية</a></nav>
<a href="https://tv10.egydead.live/category/movies/">أفلام</a>
<div class="post">
  <img src="https://tv10.egydead.live/uploads/spartacus-2004.jpg" />
  <a href="https://tv10.egydead.live/spartacus-2004/">Spartacus 2004 مترجم</a>
</div>
<div class="post">
  <a href="https://tv10.egydead.live/spartacus-1960/">Spartacus 1960 مترجم</a>
</div>
<div class="post">
  <a href="https://tv10.egydead.live/spartacus-house-of-ashur/">مسلسل Spartacus House of Ashur الموسم الاول</a>
</div>
<div class="post">
  <a href="https://tv10.egydead.live/spartacus-house-of-ashur-ep-9/">مسلسل Spartacus House of Ashur الحلقة 9 مترجمة</a>
</div>
<div class="post">
  <a href="https://tv10.egydead.live/gladiator-2000/">Gladiator 2000 مترجم</a>
</div>
<a href="https://tv10.egydead.live/wp-admin/">لوحة التحكم</a>
</body></html>
`;

const SERIES_HTML = `
<html><head><title>مسلسل Spartacus House of Ashur الموسم الاول</title>
<meta property="og:image" content="https://tv10.egydead.live/uploads/ashur.jpg" />
</head><body>
<h1>مسلسل Spartacus House of Ashur</h1>
<a href="https://tv10.egydead.live/spartacus-house-of-ashur-ep-1/">الحلقة 1 مترجمة</a>
<a href="https://tv10.egydead.live/spartacus-house-of-ashur-ep-2/">الحلقة 2 مترجمة</a>
<a href="https://tv10.egydead.live/spartacus-house-of-ashur-ep-10/">الحلقة 10 مترجمة</a>
<a href="https://tv10.egydead.live/spartacus-house-of-ashur-ep-2/">الحلقة 2 مترجمة</a>
<a href="https://tv10.egydead.live/category/series/">مسلسلات</a>
</body></html>
`;

function mockFetch(htmlByUrl: Record<string, string>, ok = true) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    for (const [key, html] of Object.entries(htmlByUrl)) {
      if (url.includes(key)) {
        return new Response(html, { status: ok ? 200 : 500, headers: { "content-type": "text/html" } });
      }
    }
    return new Response("", { status: 404 });
  };
  return originalFetch;
}

test("EgyDead search parses movie + series title pages, drops junk", async () => {
  const originalFetch = mockFetch({ "/?s=": SEARCH_HTML });
  try {
    const p = new EgyDeadProvider();
    const results = await p.search("Spartacus", "movie");
    // cleanTitle strips noise words like "مترجم".
    assert.ok(results.map((c) => c.title).includes("Spartacus 2004"));
    assert.ok(results.map((c) => c.title).includes("Spartacus 1960"));
    assert.ok(results.every((c) => c.kind === "movie"));
    assert.ok(results.every((c) => c.site === "egydead"));
    // Gladiator shares no query word and is dissimilar — filtered out.
    assert.ok(!results.map((c) => c.title).join(" ").includes("Gladiator"));
    // Poster picked up from the img near the first anchor.
    assert.ok(results.find((c) => c.title.includes("2004"))?.poster?.includes("spartacus-2004.jpg"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EgyDead series search returns the series page first", async () => {
  const originalFetch = mockFetch({ "/?s=": SEARCH_HTML });
  try {
    const p = new EgyDeadProvider();
    const results = await p.search("Spartacus", "series");
    assert.ok(results.length >= 1);
    assert.ok(results[0].title.includes("House of Ashur"));
    assert.equal(results[0].kind, "series");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EgyDead search returns [] when the site is down (fetch failure)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  try {
    const p = new EgyDeadProvider();
    assert.deepEqual(await p.search("Spartacus", "movie"), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EgyDead getDetails yields sorted, deduped episode links + stub sources", async () => {
  const originalFetch = mockFetch({
    "spartacus-house-of-ashur": SERIES_HTML,
  });
  try {
    const p = new EgyDeadProvider();
    const details = await p.getDetails({
      id: "egydead:spartacus-house-of-ashur",
      title: "Spartacus House of Ashur",
      kind: "series",
      site: "egydead",
      siteLabel: "ايجي ديد",
      url: "https://tv10.egydead.live/spartacus-house-of-ashur/",
    });
    assert.equal(details.seasons.length, 1);
    assert.deepEqual(details.seasons[0].episodes.map((e) => e.episode), [1, 2, 10]);
    assert.ok(details.poster?.includes("ashur.jpg"));
    // Stub sources point at the watch page — never a real direct file.
    assert.equal(details.sources.length, 3);
    assert.ok(details.sources.every((s) => s.url === details.candidate.url));
    const epSources = await p.getEpisodeSources(details.seasons[0].episodes[0]);
    assert.equal(epSources.length, 3);
    assert.ok(epSources[0].url.includes("ep-1"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("EgyDead resolveStream is a search-only stub (watch page, not a file)", async () => {
  const p = new EgyDeadProvider();
  const r = await p.resolveStream!("https://tv10.egydead.live/spartacus-2004/");
  assert.equal(r.directVideoUrl, "https://tv10.egydead.live/spartacus-2004/");
  assert.equal(r.directVideoUrl.endsWith(".mp4"), false);
});

test("EgyDead is registered in ALL_PROVIDERS (10th provider)", () => {
  const ids = ALL_PROVIDERS.map((p) => p.id);
  assert.ok(ids.includes("egydead"));
  assert.equal(ids.length, 10);
  const p = ALL_PROVIDERS.find((x) => x.id === "egydead")!;
  assert.deepEqual(p.kinds, ["movie", "series"]);
  assert.equal(typeof p.search, "function");
  assert.equal(typeof p.getDetails, "function");
});
