import test from "node:test";
import assert from "node:assert/strict";
import { signToken } from "../src/engine/token.ts";
import { handleStreamProxy } from "../src/engine/proxy.ts";

const SECRET = "test-secret-key-at-least-32-characters-long";

async function tokenFor(title: string): Promise<string> {
  return signToken(
    {
      u: "https://example.com/video.mp4",
      n: title,
      k: "mp4",
      e: Math.floor(Date.now() / 1000) + 3600,
    },
    SECRET,
  );
}

function installUpstreamMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("fake-video-bytes", {
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": "17" },
    });
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("dl=1 adds content-disposition attachment with the video title", async () => {
  const restore = installUpstreamMock();
  try {
    const token = await tokenFor("Interstellar 2014");
    const res = await handleStreamProxy(
      new Request(`https://worker.test/stream?t=${encodeURIComponent(token)}&dl=1`),
      SECRET,
    );
    assert.equal(res.status, 200);
    const cd = res.headers.get("content-disposition");
    assert.ok(cd, "expected content-disposition header");
    assert.ok(cd.startsWith("attachment;"), `expected attachment, got: ${cd}`);
    assert.ok(cd.includes("Interstellar"), `expected title in header, got: ${cd}`);
    assert.ok(cd.includes(".mp4"), `expected .mp4 in header, got: ${cd}`);
    // Range support stays intact so interrupted downloads can resume.
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(await res.text(), "fake-video-bytes");
  } finally {
    restore();
  }
});

test("without dl=1 no content-disposition header is set", async () => {
  const restore = installUpstreamMock();
  try {
    const token = await tokenFor("Interstellar 2014");
    const res = await handleStreamProxy(
      new Request(`https://worker.test/stream?t=${encodeURIComponent(token)}`),
      SECRET,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-disposition"), null);
  } finally {
    restore();
  }
});

test("dl=1 sanitises characters that are illegal in filenames", async () => {
  const restore = installUpstreamMock();
  try {
    const token = await tokenFor('A/B:C*D?E"F<G>H|I');
    const res = await handleStreamProxy(
      new Request(`https://worker.test/stream?t=${encodeURIComponent(token)}&dl=1`),
      SECRET,
    );
    assert.equal(res.status, 200);
    const cd = res.headers.get("content-disposition") || "";
    assert.ok(cd.includes(encodeURIComponent("A B C D E F G H I")), `unexpected header: ${cd}`);
    assert.ok(!cd.includes("/B:"), `raw illegal chars leaked into header: ${cd}`);
  } finally {
    restore();
  }
});
