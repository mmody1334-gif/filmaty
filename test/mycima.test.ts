// MyCima getDetails — episode-list fix (2026-11-18).
// The live WeCima theme (v2.0.12) renders episodes as
// <episodetitle>الحلقة N</episodetitle> anchors, NOT the old /episode/
// URLs the previous code looked for — so getDetails used to return one
// empty season and the bot showed an empty episode picker. Fixtures below
// model the real House of Ashur episode-1 page (fetched live 2026-11-18
// 00:0x): 10 <episodetitle> anchors, empty <ul id="watch">, no <btn>.
import test from "node:test";
import assert from "node:assert/strict";
import { MyCimaProvider } from "../src/providers/mycima.ts";

const EPISODE_PAGE_HTML = `
<html><head><title>مشاهدة مسلسل Spartacus: House of Ashur الحلقة 1 – وي سيما wecima</title></head><body>
<div class="WatchArea active"><div class="WatchServers" id="WatchList">
<titleshape>سيرفرات المشاهدة</titleshape>
<ul class="WatchServersList"><ul id="watch"></ul></ul></div></div>
<singlesection class="Series--Section">
<div class="EpisodesList">
<a href="https://wecima.rentals/%d9%85%d8%b4%d8%a7%d9%87%d8%af%d8%a9-%d9%85%d8%b3%d9%84%d8%b3%d9%84-spartacus-house-of-ashur-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-10-2/" class="hoverable activable"><div class="Thumb"></div><episodearea><episodetitle>الحلقة 10 </episodetitle></episodearea></a>
<a href="https://wecima.rentals/%d9%85%d8%b4%d8%a7%d9%87%d8%af%d8%a9-%d9%85%d8%b3%d9%84%d8%b3%d9%84-spartacus-house-of-ashur-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-2-2/" class="hoverable activable"><div class="Thumb"></div><episodearea><episodetitle>الحلقة 2 </episodetitle></episodearea></a>
<a href="https://wecima.rentals/%d9%85%d8%b4%d8%a7%d9%87%d8%af%d8%a9-%d9%85%d8%b3%d9%84%d8%b3%d9%84-spartacus-house-of-ashur-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-1-2/" class="hoverable activable"><div class="Thumb"></div><episodearea><episodetitle>الحلقة 1 </episodetitle></episodearea></a>
<a href="https://wecima.rentals/%d9%85%d8%b4%d8%a7%d9%87%d8%af%d8%a9-%d9%85%d8%b3%d9%84%d8%b3%d9%84-spartacus-house-of-ashur-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-1-2/" class="hoverable activable"><div class="Thumb"></div><episodearea><episodetitle>الحلقة 1 </episodetitle></episodearea></a>
</div></singlesection>
</body></html>
`;

const OLD_STYLE_HTML = `
<html><body>
<a href="https://wecima.rentals/episode/123/">الحلقة 1</a>
<a href="https://wecima.rentals/episode/124/">الحلقة 2</a>
<a href="https://wecima.rentals/episode/125/">الموسم 2 الحلقة 1</a>
</body></html>
`;

const NO_EPISODES_HTML = `
<html><head><title>مسلسل بلا حلقات</title></head><body>
<p>لا توجد حلقات بعد</p>
</body></html>
`;

function mockFetch(html: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> =>
    new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  return originalFetch;
}

const seriesCandidate = {
  id: "mycima:spartacus-house-of-ashur-1",
  title: "Spartacus House of Ashur",
  kind: "series" as const,
  site: "mycima",
  siteLabel: "ماي سيما",
  url: "https://wecima.rentals/%d9%85%d8%b4%d8%a7%d9%87%d8%af%d8%a9-%d9%85%d8%b3%d9%84%d8%b3%d9%84-spartacus-house-of-ashur-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-1-2/",
};

test("MyCima getDetails parses <episodetitle> list (newest-first → sorted, deduped)", async () => {
  const originalFetch = mockFetch(EPISODE_PAGE_HTML);
  try {
    const p = new MyCimaProvider();
    const details = await p.getDetails(seriesCandidate);
    assert.equal(details.seasons.length, 1);
    assert.deepEqual(details.seasons[0].episodes.map((e) => e.episode), [1, 2, 10]);
    assert.equal(details.seasons[0].episodes[0].season, 1);
    assert.ok(details.seasons[0].episodes[0].url.includes("wecima.rentals"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MyCima getDetails still parses old-style /episode/ links, grouped by season", async () => {
  const originalFetch = mockFetch(OLD_STYLE_HTML);
  try {
    const p = new MyCimaProvider();
    const details = await p.getDetails(seriesCandidate);
    assert.equal(details.seasons.length, 2);
    assert.deepEqual(details.seasons[0].episodes.map((e) => e.episode), [1, 2]);
    assert.deepEqual(details.seasons[1].episodes.map((e) => e.episode), [1]);
    assert.equal(details.seasons[1].season, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MyCima getDetails synthesizes the episode when the page itself is the episode", async () => {
  const originalFetch = mockFetch(NO_EPISODES_HTML);
  try {
    const p = new MyCimaProvider();
    const details = await p.getDetails(seriesCandidate);
    assert.equal(details.seasons.length, 1);
    assert.deepEqual(details.seasons[0].episodes.map((e) => e.episode), [1]);
    assert.equal(details.seasons[0].episodes[0].url, seriesCandidate.url);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MyCima getDetails returns no phantom empty season when nothing is found", async () => {
  const originalFetch = mockFetch(NO_EPISODES_HTML);
  try {
    const p = new MyCimaProvider();
    const details = await p.getDetails({
      ...seriesCandidate,
      title: "مسلسل بلا حلقات",
      url: "https://wecima.rentals/series/no-episodes/",
    });
    assert.deepEqual(details.seasons, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MyCima getEpisodeSources returns [] when the page has no <btn> servers", async () => {
  const originalFetch = mockFetch(EPISODE_PAGE_HTML);
  try {
    const p = new MyCimaProvider();
    const sources = await p.getEpisodeSources({
      season: 1,
      episode: 1,
      title: "الحلقة 1",
      url: seriesCandidate.url,
    });
    assert.deepEqual(sources, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
