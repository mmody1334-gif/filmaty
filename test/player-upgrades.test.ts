import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/index.ts";
import { resolveAllDirectStreams, resolveServersByTmdb } from "../src/engine/resolve.ts";
import { signToken, verifyToken } from "../src/engine/token.ts";
import { handleTelegramUpdate } from "../src/telegram/handlers.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";
const BASE = "https://filmaty.hudhaifa-bio.workers.dev";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockEnv() {
  const map = new Map<string, string>();
  const puts: Array<{ key: string; ttl?: number }> = [];
  return {
    map,
    puts,
    env: {
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: SECRET,
      TMDB_KEY: "test-tmdb-key",
      PUBLIC_BASE: BASE,
      CACHE: {
        get: async (k: string) => map.get(k) ?? null,
        put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
          map.set(k, v);
          puts.push({ key: k, ttl: opts?.expirationTtl });
        },
        delete: async (k: string) => {
          map.delete(k);
        },
      },
    } as any,
  };
}

// Stage 1 tests: parallel validation, multi-provider direct servers, direct CDN field.

test("Stage 1: validateStreams checks multiple qualities in parallel and preserves order", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("downet.net")) {
      await new Promise((r) => setTimeout(r, 80));
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/1000",
          "Content-Length": "1",
        },
      });
    }
    return new Response("", { status: 404 });
  };

  try {
    const fakeProvider: any = {
      id: "akwam",
      label: "أكوام",
      kinds: ["movie"],
      search: async () => [],
      getDetails: async () => ({}),
      getEpisodeSources: async () => [],
      resolveStreams: async () => [
        { quality: "1080p FHD", directVideoUrl: "https://s1.downet.net/download/a/1080p.mp4" },
        { quality: "720p HD", directVideoUrl: "https://s1.downet.net/download/a/720p.mp4" },
        { quality: "480p SD", directVideoUrl: "https://s1.downet.net/download/a/480p.mp4" },
      ],
    };

    const t0 = Date.now();
    const out = await resolveAllDirectStreams(fakeProvider, "https://akwam.ss/watch/1/1/x", "Test", "movie");
    const elapsed = Date.now() - t0;

    assert.deepEqual(
      out.map((s) => s.quality),
      ["1080p FHD", "720p HD", "480p SD"],
    );
    // Sequential 3 x 80ms = >= 240ms; parallel completes near 80ms (under 180ms margin).
    assert.ok(elapsed < 180, `expected parallel validation (<180ms), got ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stage 1: resolveServersByTmdb collects both Akwam and Laroza and uses 1h TTL for signed Laroza links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/movie/438631")) {
      return jsonResponse({
        id: 438631,
        title: "Dune",
        original_title: "Dune",
        release_date: "2021-10-22",
      });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(
        '<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/movie/777/dune">Dune (2021)</a></h3></div>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("akwam.ss/movie/777")) {
      return new Response(
        '<a href="https://akwam.ss/watch/555/777/dune">1080p</a>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("akwam.ss/watch/555")) {
      return new Response(
        '<video><source src="https://s301d5.downet.net/download/123/Dune.2021.1080p.mp4"></video>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("laroza1.cfd/search.php")) {
      return new Response(
        '<a href="https://laroza1.cfd/video.php?vid=dune1" title="فيلم Dune 2021">Dune</a>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("laroza1.cfd/download.php?vid=dune1")) {
      return new Response(
        '<a href="https://okprimeone.site/v/02/00029/dune_n/Dune.2021.720p.mp4">720p (650 MB)</a>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("downet.net") || url.includes("okprimeone.site")) {
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/650000000",
          "Content-Length": "1",
        },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };

  try {
    const { env, puts } = mockEnv();
    const res = await resolveServersByTmdb(env, "movie", 438631);
    assert.ok(res, "expected resolve result");
    assert.equal(res!.servers.length, 2, "must include both Akwam and Laroza direct servers");
    assert.match(res!.servers[0].name, /أكوام|akwam/i);
    assert.match(res!.servers[1].name, /لاروزا|laroza/i);
    assert.equal(
      puts.find((p) => p.key === "srv13:movie:438631:0:0")?.ttl,
      3600,
      "must keep 1h TTL whenever any collected server carries signed okprimeone links",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stage 1: /api/resolve exposes direct URL for downet.net and non-IP-bound okprimeone.site", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/movie/438631")) {
      return jsonResponse({ id: 438631, title: "Dune", original_title: "Dune", imdb_id: "tt1160419", release_date: "2021-10-22" });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(
        '<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/movie/777/dune">Dune</a></h3></div>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("akwam.ss/movie/777")) {
      return new Response('<a href="https://akwam.ss/watch/555/777/dune">1080p</a>', { status: 200 });
    }
    if (url.includes("akwam.ss/watch/555")) {
      return new Response(
        '<video><source src="https://s301d5.downet.net/download/123/Dune.1080p.mp4"></video>',
        { status: 200 },
      );
    }
    if (url.includes("laroza1.cfd/search.php")) {
      return new Response(
        '<a href="https://laroza1.cfd/video.php?vid=dune1" title="فيلم Dune">Dune</a>',
        { status: 200 },
      );
    }
    if (url.includes("laroza1.cfd/download.php?vid=dune1")) {
      return new Response(
        '<a href="https://okprimeone.site/v/02/00029/dune_n/Dune.720p.mp4?e=7200&i=0.0">720p</a>',
        { status: 200 },
      );
    }
    if (url.includes("downet.net") || url.includes("okprimeone.site")) {
      return new Response("x", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1000", "Content-Length": "1" },
      });
    }
    return new Response("", { status: 200 });
  };

  try {
    const { env } = mockEnv();
    const res = await worker.fetch(new Request(`${BASE}/api/resolve?type=movie&id=438631`), env, {} as any);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.direct, "https://s301d5.downet.net/download/123/Dune.1080p.mp4");
    assert.ok(body.stream.startsWith(`${BASE}/stream?t=`));
    assert.ok(body.download.endsWith("&dl=1"));

    const tok = new URL(body.stream).searchParams.get("t")!;
    const payload = await verifyToken(tok, SECRET);
    assert.equal(payload?.u, body.direct);

    // Server 0 (Akwam) and Server 1 (non-IP-locked okprimeone) both expose direct; 3 sandboxed embeds follow starting with embedwave.
    assert.equal(body.servers.length, 5);
    assert.equal(body.servers[0].qualities[0].direct, "https://s301d5.downet.net/download/123/Dune.1080p.mp4");
    assert.equal(body.servers[1].qualities[0].direct, "https://okprimeone.site/v/02/00029/dune_n/Dune.720p.mp4?e=7200&i=0.0");
    assert.equal(body.servers[2].name, "embedwave");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Stage 2 tests: WebApp cinematic player UI, JS syntax, fallback, and controls.

test("Stage 2: WebApp index.html script parses cleanly and exposes cinematic player controls", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  // Validate every inline script block parses with zero syntax errors.
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, "expected inline script in index.html");
  for (const s of scripts) {
    assert.doesNotThrow(() => new Function(s), "inline script must parse cleanly");
  }

  // Accessible viewport (no pinch-zoom lock).
  const vpMatch = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i);
  assert.ok(vpMatch, "expected viewport meta tag");
  assert.equal(vpMatch[1].includes("user-scalable=no"), false);
  assert.equal(vpMatch[1].includes("maximum-scale=1.0"), false);

  // Player controls and UX enhancements.
  for (const id of [
    "modalCard",
    "iframeSpinner",
    "seekIndicator",
    "playerToolbar",
    "btnSeekBack",
    "btnSeekFwd",
    "playerSpeedSelect",
    "btnPip",
    "btnTheater",
    "btnFullscreen",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `expected #${id} in index.html`);
  }

  // Behavior wiring: 25s resolve timeout, resume timestamp on switch, CDN direct fallback, orientation lock.
  assert.ok(html.includes("25000"), "expected 25000ms resolve timeout");
  assert.ok(html.includes("captureCurrentPlaybackTime"), "expected playback timestamp capture on server/quality switch");
  assert.ok(html.includes("quality.direct"), "expected quality.direct usage");
  assert.ok(html.includes("quality.stream"), "expected quality.stream fallback usage");
  assert.ok(html.includes("orientation.lock"), "expected landscape orientation lock on fullscreen");
  assert.ok(html.includes("prefers-reduced-motion"), "expected reduced-motion CSS support");
});

// Stage 3 tests: TV full-viewport cinema HUD, direct CDN fallback, remote controls.

test("Stage 3: Tv/index.html and Tv/remote/index.html parse cleanly and wire cinema + remote controls", () => {
  const tvHtml = readFileSync(join(process.cwd(), "Tv", "index.html"), "utf8");
  const tvScripts = [...tvHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(tvScripts.length >= 1, "expected inline script in Tv/index.html");
  for (const s of tvScripts) {
    assert.doesNotThrow(() => new Function(s), "Tv/index.html script must parse cleanly");
  }

  for (const id of [
    "tvHudBar",
    "tvExitPlayer",
    "tvSeekBack",
    "tvTogglePlay",
    "tvSeekFwd",
    "tvMuteBtn",
    "tvNextEpBtn",
    "tvQuickServersBtn",
  ]) {
    assert.ok(tvHtml.includes(`id="${id}"`), `expected #${id} in Tv/index.html`);
  }
  assert.ok(tvHtml.includes("captureTvResume"), "expected pendingResume capture in Tv/index.html");
  assert.ok(tvHtml.includes("quality.direct"), "expected quality.direct usage in Tv/index.html");
  assert.ok(tvHtml.includes("fastPollTimer"), "expected fastPollTimer in Tv/index.html");
  assert.match(tvHtml, /cmd\.action === ['"]seek['"]/);
  assert.match(tvHtml, /cmd\.action === ['"]mute['"]/);
  assert.match(tvHtml, /cmd\.action === ['"]next['"]/);

  const remoteHtml = readFileSync(join(process.cwd(), "Tv", "remote", "index.html"), "utf8");
  const remoteScripts = [...remoteHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(remoteScripts.length >= 1, "expected inline script in Tv/remote/index.html");
  for (const s of remoteScripts) {
    assert.doesNotThrow(() => new Function(s), "Tv/remote/index.html script must parse cleanly");
  }

  const vpMatch = remoteHtml.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i);
  assert.ok(vpMatch, "expected viewport meta in Tv/remote/index.html");
  assert.equal(vpMatch[1].includes("user-scalable=no"), false);
  assert.equal(vpMatch[1].includes("maximum-scale=1.0"), false);

  for (const id of ["remoteSeekBack", "remoteToggle", "remoteSeekFwd", "remoteMute", "remoteNext", "remoteClose"]) {
    assert.ok(remoteHtml.includes(`id="${id}"`), `expected #${id} in Tv/remote/index.html`);
  }
});

// Stage 4 tests: /watch player upgrades and signed /watch?t=... links in Telegram bot.

test("Stage 4: GET /watch?t=... renders accessible player with directUrl, /stream fallback, &dl=1, and valid JS", async () => {
  const { env } = mockEnv();
  const direct = "https://s301d5.downet.net/download/123/Dune.1080p.mp4";
  const token = await signToken(
    {
      u: direct,
      n: "Dune (2021)",
      k: "mp4",
      e: Math.floor(Date.now() / 1000) + 3600,
    },
    SECRET,
  );

  const res = await worker.fetch(new Request(`${BASE}/watch?t=${encodeURIComponent(token)}`), env, {} as any);
  assert.equal(res.status, 200);
  const html = await res.text();

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, "expected inline script in /watch HTML");
  for (const s of scripts) {
    assert.doesNotThrow(() => new Function(s), "/watch inline script must parse cleanly");
  }

  const vpMatch = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i);
  assert.ok(vpMatch, "expected viewport meta in /watch");
  assert.equal(vpMatch[1].includes("user-scalable=no"), false);
  assert.equal(vpMatch[1].includes("maximum-scale=1.0"), false);

  assert.ok(html.includes(direct), "expected CORS-open directUrl on primary video source");
  assert.ok(html.includes(`${BASE}/stream?t=${encodeURIComponent(token)}&amp;dl=1`), "expected HTML-escaped &dl=1 download URL");
  assert.ok(html.includes("watchSeekBack"), "expected -10s button");
  assert.ok(html.includes("watchSeekFwd"), "expected +10s button");
  assert.ok(html.includes("prefers-reduced-motion"), "expected reduced-motion CSS");
});

test("Stage 4: Telegram mov|q| action card uses signed /watch?t=... URL for Watch Online button", async () => {
  const { env, map } = mockEnv();
  map.set(
    "mov_d:item1",
    JSON.stringify({
      details: {
        title: "Dune",
        kind: "movie",
        poster: "",
        candidate: {
          id: "777",
          title: "Dune",
          kind: "movie",
          site: "akwam",
          siteLabel: "أكوام",
          url: "https://akwam.ss/movie/777/dune",
          similarity: 1,
        },
        sources: [
          {
            label: "1080p",
            quality: "1080p FHD",
            url: "https://akwam.ss/watch/555/777/dune",
            direct: false,
            fileSize: "1.5 GB",
          },
        ],
      },
      searchKey: "sk1",
    }),
  );

  const edits: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.telegram.org")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("editMessageText") || url.includes("editMessageCaption")) edits.push(body);
      return jsonResponse({ ok: true, result: { message_id: 42 } });
    }
    if (url.includes("akwam.ss/watch/555")) {
      return new Response(
        '<video><source src="https://s301d5.downet.net/download/123/Dune.1080p.mp4"></video>',
        { status: 200 },
      );
    }
    if (url.includes("downet.net")) {
      return new Response("x", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1000", "Content-Length": "1" },
      });
    }
    return new Response("", { status: 404 });
  };

  try {
    await handleTelegramUpdate(
      {
        callback_query: {
          id: "cb-1",
          from: { id: 100 },
          data: "mov|q|item1|0",
          message: { message_id: 42, chat: { id: 100 }, text: "picking..." },
        },
      },
      env,
    );

    const card = edits.find((e) => e.reply_markup?.inline_keyboard?.length >= 3);
    assert.ok(card, "expected edited message with stream-ready keyboard");
    const watchBtn = card.reply_markup.inline_keyboard[2][0];
    assert.equal(watchBtn.text, "▶️ مشاهدة مباشرة أونلاين");
    assert.ok(watchBtn.url.startsWith(`${BASE}/watch?t=`), `expected signed /watch URL, got ${watchBtn.url}`);
    const tok = new URL(watchBtn.url).searchParams.get("t")!;
    const decoded = await verifyToken(tok, SECRET);
    assert.equal(decoded?.u, "https://s301d5.downet.net/download/123/Dune.1080p.mp4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Netflix redesign & EmbedWave-only download UX fix.

test("Netflix redesign: index.html ships Netflix hero, backdrop modal, high-contrast palette, and honest EmbedWave-only download state", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

  for (const id of [
    "heroBanner",
    "heroImg",
    "heroPlayBtn",
    "heroInfoBtn",
    "modalBackdropWrap",
    "modalBackdropImg",
    "btnDirectDownloadLabel",
    "btnDirectDownloadIcon",
    "brandHomeBtn",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `expected #${id} in index.html`);
  }

  const heroImgTag = html.match(/<img\s+[^>]*id="heroImg"[^>]*>/i)?.[0] || "";
  assert.ok(heroImgTag.includes('fetchpriority="high"'), "hero image must use fetchpriority=high");
  assert.equal(heroImgTag.includes('loading="lazy"'), false, "hero image must never lazy-load");

  assert.ok(html.includes("#141414"), "expected Netflix dark canvas #141414");
  assert.ok(html.includes("#181818"), "expected Netflix surface #181818");
  assert.ok(html.includes("#e50914"), "expected Netflix accent #e50914");
  assert.ok(html.includes('<meta name="theme-color" content="#0b0f19">'), "keep PWA theme-color intact");
  assert.ok(html.includes("syncDownloadButtonState"), "expected download button state sync");
  assert.ok(html.includes("getDownloadQualities"), "expected direct quality filter helper");
  assert.ok(html.includes("متاح مشاهدة أونلاين فقط"), "expected online-only download button state");
  assert.ok(html.includes("renderHeroBanner"), "expected Netflix hero renderer");
  assert.ok(html.includes('id="btnShareMedia"'), "expected #btnShareMedia share button");
  assert.ok(html.includes("buildShareUrl"), "expected buildShareUrl deep-link builder");
  assert.ok(html.includes("syncUrlWithModal"), "expected syncUrlWithModal browser history sync");
  assert.ok(html.includes("applyUrlParams"), "expected startup/popstate deep-link handler");
  assert.ok(html.includes("popstate"), "expected popstate back-button listener");
  assert.ok(html.includes("navigator.share"), "expected Web Share API support");
  assert.ok(html.includes("color-scheme: dark"), "expected dark native scrollbar/form scheme");
  assert.ok(html.includes("iframeSpinnerLabel"), "expected spinner label element for native + iframe loading");
});

test("Resolve speed & accuracy: omits direct for IP-locked okprimeone, omits embedwave on imdb_id:null stubs, and resolves sites in parallel", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/movie/1828781")) {
      return jsonResponse({ id: 1828781, title: "Avengers : Endgame Extended", original_title: "Avengers : Endgame Extended", imdb_id: null, release_date: "" });
    }
    if (url.includes("api.themoviedb.org/3/movie/777777")) {
      return jsonResponse({ id: 777777, title: "Unresolvable Stub", original_title: "Unresolvable Stub", imdb_id: null, release_date: "" });
    }
    if (url.includes("akwam.ss/search")) {
      return new Response(
        '<div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/movie/11679/avengers-endgame-encore">Avengers Endgame Extended</a></h3></div>',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url.includes("akwam.ss/movie/11679")) {
      return new Response('<a href="https://akwam.ss/watch/184756/11679/avengers-endgame-encore">720p</a>', { status: 200 });
    }
    if (url.includes("akwam.ss/watch/184756")) {
      return new Response('<video><source src="https://s204d1.downet.net/download/999/endgame.mp4"></video>', { status: 200 });
    }
    if (url.includes("s204d1.downet.net")) {
      await new Promise((r) => setTimeout(r, 120));
      return new Response("dead", { status: 526, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("laroza1.cfd/search.php")) {
      return new Response(
        '<a href="https://laroza1.cfd/video.php?vid=eqe3" title="فيلم Avengers : Endgame Extended">Avengers : Endgame Extended</a>',
        { status: 200 },
      );
    }
    if (url.includes("laroza1.cfd/download.php?vid=eqe3")) {
      await new Promise((r) => setTimeout(r, 120));
      return new Response(
        '<a href="https://cdn2.okprimeone.site/v/01/eqe3_n/Encore.720p.mp4?e=7200&i=197.1.2.3">720p</a>',
        { status: 200 },
      );
    }
    if (url.includes("okprimeone.site")) {
      return new Response("x", {
        status: 206,
        headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-0/1000", "Content-Length": "1" },
      });
    }
    return new Response("", { status: 200 });
  };

  try {
    const { env } = mockEnv();
    const t0 = Date.now();
    const res = await worker.fetch(new Request(`${BASE}/api/resolve?type=movie&id=1828781`), env, {} as any);
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.direct, undefined, "IP-locked okprimeone link must omit direct");
    assert.equal(body.servers.length, 1, "imdb_id:null movie stub must omit embedwave");
    assert.equal(body.servers[0].name, "لاروزا");
    // Sequential 2 x 120ms = >= 240ms; parallel overlaps both providers under 210ms.
    assert.ok(elapsed < 210, `expected parallel Akwam+Laroza evaluation (<210ms), got ${elapsed}ms`);

    const stubRes = await worker.fetch(new Request(`${BASE}/api/resolve?type=movie&id=777777`), env, {} as any);
    assert.equal(stubRes.status, 404);
    const stubBody = (await stubRes.json()) as any;
    assert.deepEqual(stubBody.servers, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
