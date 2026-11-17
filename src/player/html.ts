export interface PlayerOptions {
  title: string;
  streamUrl: string;
  downloadUrl?: string;
  directUrl?: string;
  kind: "mp4" | "hls" | "embed";
  quality?: string;
  season?: number;
  episode?: number;
  poster?: string;
  serverTag?: string;
}

export function renderPlayerHtml(opts: PlayerOptions): string {
  const safeTitle = escapeHtml(opts.title);
  const isEmbed = opts.kind === "embed";
  const isHls = opts.kind === "hls";
  const initialVideoSrc = !isHls && opts.directUrl ? opts.directUrl : opts.streamUrl;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} - Filmaty Player</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
  <style>
    :root {
      --bg: #090b10;
      --card-bg: #121622;
      --accent: #e50914;
      --accent-glow: rgba(229, 9, 20, 0.35);
      --text: #f3f4f6;
      --muted: #9ca3af;
      --border: #1f293d;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }
    header {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(18, 22, 34, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .brand span { color: var(--accent); }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(229, 9, 20, 0.15);
      color: #ff4d4d;
      border: 1px solid rgba(229, 9, 20, 0.3);
    }
    .player-container {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      background: #000;
      position: relative;
      aspect-ratio: 16 / 9;
      box-shadow: 0 10px 40px rgba(0,0,0,0.8);
    }
    video, iframe {
      width: 100%;
      height: 100%;
      display: block;
      border: none;
      background: #000;
    }
    .meta-bar {
      max-width: 1100px;
      width: 100%;
      margin: 0 auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      color: #fff;
      line-height: 1.4;
    }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tag {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      color: var(--muted);
    }
    .tag.highlight {
      color: var(--success);
      border-color: rgba(16, 185, 129, 0.3);
      background: rgba(16, 185, 129, 0.1);
    }
    .actions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 8px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 0.92rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      box-shadow: 0 4px 14px var(--accent-glow);
    }
    .btn-primary:hover {
      background: #c70812;
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: var(--card-bg);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover {
      background: #1a2030;
      border-color: #3b4760;
    }
    .controls-panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      color: var(--muted);
    }
    select {
      background: #0d111a;
      color: #fff;
      border: 1px solid var(--border);
      min-height: 44px;
      padding: 6px 12px;
      border-radius: 6px;
      outline: none;
      cursor: pointer;
    }
    :focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    }
    footer {
      margin-top: auto;
      padding: 24px 20px;
      text-align: center;
      font-size: 0.8rem;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      🎬 <span>Filmaty</span> مشغل فيلماتي
    </div>
    <div class="badge">${escapeHtml(opts.serverTag || "⚡️ تشغيل فائق")}</div>
  </header>

  <div class="player-container">
    ${
      isEmbed
        ? `<iframe src="${escapeHtml(opts.streamUrl)}" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`
        : `<video id="videoPlayer" controls playsinline preload="metadata" poster="${escapeHtml(opts.poster || "")}">
             <source src="${escapeHtml(initialVideoSrc)}" type="${isHls ? "application/x-mpegURL" : "video/mp4"}">
           </video>`
    }
  </div>

  <div class="meta-bar">
    <div class="title-row">
      <h1>${safeTitle}</h1>
      <div class="tag-row">
        ${opts.quality ? `<span class="tag highlight">⚡️ ${escapeHtml(opts.quality)}</span>` : ""}
        ${opts.season ? `<span class="tag">الموسم ${opts.season}</span>` : ""}
        ${opts.episode ? `<span class="tag">الحلقة ${opts.episode}</span>` : ""}
        <span class="tag highlight">🟢 مباشر ومفحوص</span>
      </div>
    </div>

    ${
      !isEmbed
        ? `
    <div class="controls-panel">
      <div class="control-group">
        <label for="speedSelect">⚡️ السرعة:</label>
        <select id="speedSelect" onchange="changeSpeed(this.value)">
          <option value="0.5">0.5x</option>
          <option value="0.75">0.75x</option>
          <option value="1" selected>1.0x عادي</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2.0x</option>
        </select>
      </div>
      <div class="control-group" style="flex-wrap: wrap;">
        <button id="watchSeekBack" type="button" class="btn btn-secondary" onclick="seekBy(-10)">⏪ -10 ث</button>
        <button id="watchSeekFwd" type="button" class="btn btn-secondary" onclick="seekBy(10)">+10 ث ⏩</button>
        <button id="watchMuteBtn" type="button" class="btn btn-secondary" onclick="toggleMute()">🔇 كتم</button>
        <button class="btn btn-secondary" type="button" onclick="togglePip()">📺 صورة داخل صورة (PiP)</button>
        <button class="btn btn-secondary" type="button" onclick="toggleFullscreen()">⛶ شاشة كاملة</button>
      </div>
    </div>
    `
        : ""
    }

    <div class="actions-grid">
      ${
        opts.downloadUrl
          ? `<a href="${escapeHtml(opts.downloadUrl)}" class="btn btn-primary" download target="_blank">📥 تحميل مباشر فائق السرعة</a>`
          : `<a href="${escapeHtml(opts.streamUrl)}" class="btn btn-primary" download target="_blank">📥 تحميل الملف</a>`
      }
      <button class="btn btn-secondary" type="button" onclick="closeTelegram()">↩️ رجوع للتليجرام</button>
    </div>
  </div>

  <footer>
    Filmaty Bot • مشغل وسائط فائق الأداء مبني على Cloudflare Workers
  </footer>

  <script>
    const STREAM_FALLBACK_URL = ${jsonForScript(opts.streamUrl)};
    const WATCH_POS_KEY = ${jsonForScript(`filmaty:watch-pos:${opts.title || ""}:${opts.season || 0}:${opts.episode || 0}`)};
    let usingDirectCdn = ${Boolean(!isHls && opts.directUrl)};
    let savedPosApplied = false;
    let lastPosSave = 0;

    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.expand();
      window.Telegram.WebApp.ready();
    }

    const video = document.getElementById('videoPlayer');
    if (video) {
      ${
        isHls
          ? `
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls({ capLevelToPlayerSize: true });
        hls.loadSource(STREAM_FALLBACK_URL);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = STREAM_FALLBACK_URL;
      }
      `
          : ""
      }

      video.addEventListener('error', () => {
        if (usingDirectCdn && STREAM_FALLBACK_URL) {
          usingDirectCdn = false;
          const prevTime = Number.isFinite(video.currentTime) && video.currentTime > 3 ? video.currentTime : 0;
          video.src = STREAM_FALLBACK_URL;
          if (prevTime > 0) {
            video.addEventListener('loadedmetadata', () => {
              if (Number.isFinite(video.duration) && video.duration > prevTime + 2) {
                video.currentTime = prevTime;
              }
            }, { once: true });
          }
          video.play().catch(() => {});
        }
      });

      video.addEventListener('loadedmetadata', () => {
        if (savedPosApplied) return;
        savedPosApplied = true;
        try {
          const raw = localStorage.getItem(WATCH_POS_KEY);
          const pos = raw ? Number(raw) : 0;
          if (Number.isFinite(pos) && pos > 5 && Number.isFinite(video.duration) && pos < video.duration - 15) {
            video.currentTime = pos;
          }
        } catch (e) {}
      });

      function persistWatchPos(force) {
        if (!Number.isFinite(video.currentTime) || video.currentTime < 5) return;
        const now = Date.now();
        if (!force && now - lastPosSave < 5000) return;
        lastPosSave = now;
        try { localStorage.setItem(WATCH_POS_KEY, String(Math.floor(video.currentTime))); } catch (e) {}
      }
      video.addEventListener('timeupdate', () => persistWatchPos(false));
      video.addEventListener('pause', () => persistWatchPos(true));
      video.addEventListener('ended', () => {
        try { localStorage.removeItem(WATCH_POS_KEY); } catch (e) {}
      });
      video.addEventListener('volumechange', updateMuteLabel);
    }

    function seekBy(delta) {
      if (!video) return;
      const dur = video.duration;
      const next = (Number.isFinite(video.currentTime) ? video.currentTime : 0) + delta;
      video.currentTime = Number.isFinite(dur) ? Math.max(0, Math.min(dur, next)) : Math.max(0, next);
    }

    function updateMuteLabel() {
      const btn = document.getElementById('watchMuteBtn');
      if (!btn || !video) return;
      btn.textContent = video.muted ? '🔊 إلغاء الكتم' : '🔇 كتم';
    }

    function toggleMute() {
      if (!video) return;
      video.muted = !video.muted;
      updateMuteLabel();
    }

    function changeSpeed(val) {
      if (video) video.playbackRate = parseFloat(val);
    }

    function togglePip() {
      if (!video) return;
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      } else if (video.requestPictureInPicture) {
        video.requestPictureInPicture().catch(() => {});
      }
    }

    function toggleFullscreen() {
      if (!video) return;
      const req = video.requestFullscreen
        ? video.requestFullscreen()
        : (video.webkitRequestFullscreen ? video.webkitRequestFullscreen() : null);
      if (req && req.then) {
        req.then(() => {
          try {
            if (screen.orientation && screen.orientation.lock) {
              screen.orientation.lock('landscape').catch(() => {});
            }
          } catch (e) {}
        }).catch(() => {});
      }
    }

    document.addEventListener('keydown', (e) => {
      if (!video) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-10); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(10); }
      else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        if (video.paused) video.play().catch(() => {}); else video.pause();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    });

    function closeTelegram() {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.close();
      } else {
        window.history.back();
      }
    }
  </script>
</body>
</html>`;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
