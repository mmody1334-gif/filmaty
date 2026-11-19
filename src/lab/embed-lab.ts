// /lab — hidden test page for candidate TMDB-id embed servers.
// Every server loads in the same ad-blocking sandbox the site uses
// (no allow-popups / allow-top-navigation), so a server that plays here
// plays ad-free on the site. Not linked from the UI.

const SANDBOX = "allow-same-origin allow-scripts allow-presentation allow-forms";

export const LAB_SERVERS: Record<string, { movie: string; tv: string }> = {
  embedwave: { movie: "https://embedwave.cc/embed/movie/{id}", tv: "https://embedwave.cc/embed/tv/{id}/{s}/{e}" },
  "2embed.cc": { movie: "https://www.2embed.cc/embed/{id}", tv: "https://www.2embed.cc/embedtv/{id}&s={s}&e={e}" },
  "2embed.skin": { movie: "https://www.2embed.skin/embed/{id}", tv: "https://www.2embed.skin/embedtv/{id}&s={s}&e={e}" },
  nontongo: { movie: "https://www.nontongo.win/embed/movie/{id}", tv: "https://www.nontongo.win/embed/tv/{id}/{s}/{e}" },
  "vidsrc.net": { movie: "https://vidsrc.net/embed/movie?tmdb={id}", tv: "https://vidsrc.net/embed/tv?tmdb={id}&season={s}&episode={e}" },
  "vidsrc.in": { movie: "https://vidsrc.in/embed/movie/{id}", tv: "https://vidsrc.in/embed/tv/{id}/{s}/{e}" },
  "vidsrc.pm": { movie: "https://vidsrc.pm/embed/movie/{id}", tv: "https://vidsrc.pm/embed/tv/{id}/{s}/{e}" },
  videasy: { movie: "https://player.videasy.net/movie/{id}", tv: "https://player.videasy.net/tv/{id}/{s}/{e}" },
  "embed.su": { movie: "https://embed.su/embed/movie/{id}", tv: "https://embed.su/embed/tv/{id}/{s}/{e}" },
  moviesapi: { movie: "https://moviesapi.club/movie/{id}", tv: "https://moviesapi.club/tv/{id}-{s}-{e}" },
  autoembed: { movie: "https://player.autoembed.cc/embed/movie/{id}", tv: "https://player.autoembed.cc/embed/tv/{id}/{s}/{e}" },
  vidking: { movie: "https://www.vidking.net/embed/movie/{id}", tv: "https://www.vidking.net/embed/tv/{id}/{s}/{e}" },
};

export function labHtml(url: URL): Response {
  const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  const id = String(Number(url.searchParams.get("id")) || (type === "tv" ? 1399 : 157336));
  const s = String(Number(url.searchParams.get("s")) || 1);
  const e = String(Number(url.searchParams.get("e")) || 1);
  const items = Object.entries(LAB_SERVERS)
    .map(([name, t]) => {
      const src = t[type].replace("{id}", id).replace("{s}", s).replace("{e}", e);
      return `<section><h2>${name}</h2><button data-src="${src}">▶ حمّل السيرفر</button><div class="box"></div></section>`;
    })
    .join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Filmaty lab</title><style>body{background:#111;color:#eee;font:15px system-ui;margin:12px}section{margin:0 0 18px}h2{font-size:16px;margin:4px 0}
button{background:#e50914;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:bold}.box iframe{width:100%;aspect-ratio:16/9;border:0;background:#000;margin-top:6px}
form{margin-bottom:16px}input,select{background:#222;color:#fff;border:1px solid #444;border-radius:4px;padding:6px;width:70px}</style></head><body>
<form><select name="type"><option value="movie"${type === "movie" ? " selected" : ""}>فيلم</option><option value="tv"${type === "tv" ? " selected" : ""}>مسلسل</option></select>
TMDB <input name="id" value="${id}"> S <input name="s" value="${s}"> E <input name="e" value="${e}"> <button>تغيير</button></form>
<p>كل سيرفر شغال جوه إطار يمنع الإعلانات المنبثقة. جرّب واحد واحد واكتب اللي اشتغل.</p>${items}
<script>document.querySelectorAll('section button').forEach(b=>b.onclick=()=>{const box=b.nextElementSibling;box.innerHTML='';const f=document.createElement('iframe');f.setAttribute('sandbox','${SANDBOX}');f.allow='autoplay; fullscreen; encrypted-media';f.allowFullscreen=true;f.referrerPolicy='origin';f.src=b.dataset.src;box.appendChild(f);});</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
}
