const CACHE_NAME = "filmaty-shell-v1";
const PRECACHE_ASSETS = [
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_ASSETS.map((asset) => cache.add(asset)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("filmaty-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  if (
    path.includes("/api/") ||
    path.endsWith("/stream") ||
    path.includes("/stream?") ||
    path.endsWith("/watch") ||
    path.endsWith("/lab")
  ) {
    return;
  }

  // Network-first for HTML navigations so fresh deploys arrive immediately.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response(
          '<!doctype html><html lang="ar" dir="rtl"><body style="background:#141414;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2>لا يوجد اتصال بالإنترنت</h2><p>تأكد من الشبكة ثم أعد المحاولة.</p></div></body></html>',
          { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      })
    );
    return;
  }

  // Cache-first for posters (/img/) and PWA static assets (/icons/, manifest.json).
  if (
    path.includes("/img/") ||
    path.includes("/icons/") ||
    path.endsWith("/manifest.json")
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      })
    );
  }
});
