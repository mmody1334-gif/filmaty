import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { resolveServersByTmdb, embedwaveUrl, buildEmbedServers } from "../src/engine/resolve.ts";
import { AkwamProvider } from "../src/providers/akwam.ts";
import { verifyToken } from "../src/engine/token.ts";

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
  return {
    map,
    env: {
      BOT_TOKEN: "test-bot-token",
      SIGNING_SECRET: SECRET,
      TMDB_KEY: "test-tmdb-key",
      PUBLIC_BASE: BASE,
      CACHE: {
        get: async (k: string) => map.get(k) ?? null,
        put: async (k: string, v: string) => {
          map.set(k, v);
        },
        delete: async (k: string) => {
          map.delete(k);
        },
      },
    } as any,
  };
}

// Mocked network for the multi-quality Interstellar scenario: TMDB knows
// Interstellar; the embed provider's vidsrc page lists 480p/720p/1080p
// files; validation probes answer 206 video/mp4 except for URLs on
// dead.downet.net (526). Every other provider returns an empty page.
function installQualityMock(opts: { dead1080?: boolean; allDead?: boolean } = {}) {
  const originalFetch = globalThis.fetch;
  const host = (q: string) =>
    opts.allDead || (opts.dead1080 && q === "1080p") ? "dead" : "s204d1";
  const vidsrcHtml = `
    <html><body>
      <video>
        <source src="https://${host("480p")}.downet.net/download/123/Interstellar.480p.mp4">
        <source src="https://${host("720p")}.downet.net/download/123/Interstellar.720p.mp4">
        <source src="https://${host("1080p")}.downet.net/download/123/Interstellar.1080p.mp4">
      </video>
    </body></html>
  `;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes("api.themoviedb.org/3/movie/157336")) {
      return jsonResponse({
        id: 157336,
        title: "Interstellar",
        original_title: "Interstellar",
        release_date: "2014-11-05",
      });
    }
    if (url.includes("api.themoviedb.org/3/movie/")) {
      return new Response(JSON.stringify({ status_message: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("api.themoviedb.org")) {
      return jsonResponse({ results: [] });
    }
    if (url.includes("vidsrc.to") || url.includes("vidsrc.me") || url.includes("streamwish.to")) {
      return new Response(vidsrcHtml, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    if (url.includes("dead.downet.net")) {
      return new Response("Cloudflare 526 error page", {
        status: 526,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.includes("downet.net")) {
      return new Response("x", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-0/441957985",
          "Content-Length": "1",
        },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("Akwam resolveStreams returns all qualities best-first", async () => {
  const restore = installQualityMock();
  try {
    const streams = await new AkwamProvider().resolveStreams("https://vidsrc.to/embed/movie?title=Interstellar");
    assert.equal(streams.length, 3);
    assert.deepEqual(
      streams.map((s) => s.quality),
      ["1080p FHD", "720p HD", "480p SD"],
    );
    assert.ok(streams[0].directVideoUrl.includes("1080p"));
    assert.ok(streams[2].directVideoUrl.includes("480p"));
  } finally {
    restore();
  }
});

test("resolveServersByTmdb lists all validated qualities on the native server", async () => {
  const restore = installQualityMock();
  const { env } = mockEnv();
  try {
    const result = await resolveServersByTmdb(env, "movie", 157336);
    assert.ok(result, "expected a resolved result");
    assert.equal(result!.title, "Interstellar");
    assert.equal(result!.servers.length, 1);
    assert.deepEqual(
      result!.servers[0].qualities.map((q) => q.quality),
      ["1080p FHD", "720p HD", "480p SD"],
    );
    assert.ok(result!.servers[0].qualities[0].directVideoUrl.includes("1080p"));
  } finally {
    restore();
  }
});

test("a dead quality is excluded and the next best becomes default", async () => {
  const restore = installQualityMock({ dead1080: true });
  const { env } = mockEnv();
  try {
    const result = await resolveServersByTmdb(env, "movie", 157336);
    assert.ok(result, "expected a resolved result");
    assert.deepEqual(
      result!.servers[0].qualities.map((q) => q.quality),
      ["720p HD", "480p SD"],
    );
  } finally {
    restore();
  }
});

test("GET /api/resolve returns servers (native multi-quality + embedwave) and best as default", async () => {
  const restore = installQualityMock();
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/resolve?type=movie&id=157336`),
      env,
      {} as any,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.title, "Interstellar");
    // Top-level fields stay the default = best quality of the first server.
    assert.equal(body.quality, "1080p FHD");
    const token = new URL(body.stream).searchParams.get("t")!;
    const payload = await verifyToken(token, SECRET);
    assert.ok(payload);
    assert.ok(payload!.u.includes("1080p"));

    assert.equal(body.servers.length, 4);
    assert.equal(body.servers[0].qualities.length, 3);
    for (const q of body.servers[0].qualities) {
      assert.ok(q.stream.startsWith(`${BASE}/stream?t=`));
      assert.ok(q.download.startsWith(`${BASE}/stream?t=`));
      assert.ok(q.download.endsWith("&dl=1"));
    }
    // embedwave comes first, followed by 2 backup sandboxed embeds.
    assert.equal(body.servers[1].name, "embedwave");
    assert.equal(body.servers[1].qualities.length, 1);
    assert.equal(body.servers[1].qualities[0].stream, "https://embedwave.cc/embed/movie/157336");
    assert.equal(body.servers[1].qualities[0].download, undefined);
    for (const emb of body.servers.slice(1)) {
      assert.equal(emb.embed, true);
      assert.equal(emb.qualities.length, 1);
      assert.equal(emb.qualities[0].download, undefined);
    }
  } finally {
    restore();
  }
});

test("embed fallback list excludes providers that refuse the sandbox", () => {
  // nontongo.win, vidfast.pro and multiembed.mov render "Please Disable Sandbox"
  // inside the site's sandboxed iframe (verified live 2026-11-21), so they must
  // never be offered as fallback servers.
  const refusedHosts = ["nontongo.win", "vidfast.pro", "vidfast.vc", "multiembed.mov"];
  for (const type of ["movie", "tv"] as const) {
    const servers = buildEmbedServers(type, 157336, 1, 1);
    assert.deepEqual(
      servers.map((s) => s.name),
      ["embedwave", "2embed", "2embed-2"],
    );
    for (const server of servers) {
      const host = new URL(server.qualities[0].stream).host;
      for (const refused of refusedHosts) {
        assert.ok(!host.endsWith(refused), `${host} must not be ${refused}`);
      }
    }
  }
});

test("embedwaveUrl builds the TMDB-id embed URLs for movies and episodes", () => {
  assert.equal(embedwaveUrl("movie", 157336), "https://embedwave.cc/embed/movie/157336");
  assert.equal(embedwaveUrl("tv", 48866, 7, 1), "https://embedwave.cc/embed/tv/48866/7/1");
});

test("no validated native stream: ok:false returns embedwave and backup embed servers", async () => {
  const restore = installQualityMock({ allDead: true });
  const { env } = mockEnv();
  try {
    const res = await worker.fetch(
      new Request(`${BASE}/api/resolve?type=movie&id=157336`),
      env,
      {} as any,
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as any;
    assert.equal(body.ok, false);
    assert.equal(body.servers.length, 3);
    assert.equal(body.servers[0].name, "embedwave");
    assert.equal(body.servers[0].qualities[0].stream, "https://embedwave.cc/embed/movie/157336");
    assert.deepEqual(
      body.servers.map((s: any) => s.name),
      ["embedwave", "2embed", "2embed-2"],
    );
  } finally {
    restore();
  }
});
