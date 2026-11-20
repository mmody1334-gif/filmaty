import { cleanTitle, computeSimilarity, normalizeArabic, parseYear, isDubbed } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, SeasonGroup, SourceLink, ResolvedStream } from "./types.ts";

// EgyDead (ايجي ديد) — Arabic movies/series/anime site (WordPress).
// Base URL + search shape come from the public Nuvio Arabic provider
// plugin (SafaaSalam/Arabic-Nuvio, providers/egydead.js):
//   DEFAULT_MAIN_URL = "https://tv10.egydead.live", SEARCH_PATH = "/?s={query}".
// The live site could NOT be reached while this was written (2026-11-17
// 23:39: tv10 times out, a1.egydead.media answers Cloudflare 522 — the
// origin server is down), so the parsing mirrors that plugin's
// markup-agnostic approach: scan every <a> on the search page and match
// by title text, skipping nav/admin/category paths. Re-verify against the
// live site when it comes back.
// SEARCH-ONLY by construction: resolveStream returns the watch page URL
// itself, which fails validateDirectUrl, so EgyDead can never surface as
// a native direct stream. It feeds /api/search provider fallback, the
// single-token augmentation, and the bot's shared sweep only. The
// resolver's direct list (akwam/laroza/embed) is untouched.
export const EGYDEAD_BASE = "https://tv10.egydead.live";

export function egydeadHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9",
    Referer: `${EGYDEAD_BASE}/`,
  };
}

// Paths that are never a title page (mirrors the Nuvio plugin's skip list).
const SKIP_PATH = /\/(?:category|tag|genre|page|search|login|register|contact|wp-content|wp-admin|feed|author)\b/i;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function isSeriesTitle(rawTitle: string): boolean {
  return (
    rawTitle.includes("مسلسل") ||
    rawTitle.includes("الحلقة") ||
    rawTitle.includes("حلقة") ||
    rawTitle.includes("الموسم")
  );
}

function isEpisodeCard(rawTitle: string): boolean {
  return /(?:الحلقة|حلقة)\s*\d+/i.test(rawTitle);
}

function slugOf(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : url;
  } catch {
    return url;
  }
}

export class EgyDeadProvider implements Provider {
  id = "egydead";
  label = "ايجي ديد";
  kinds: MediaKind[] = ["movie", "series"];

  async search(query: string, targetKind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url = `${EGYDEAD_BASE}/?s=${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(url, { headers: egydeadHeaders(), signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const html = await res.text();

      const anchorRegex = /<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let am: RegExpExecArray | null;
      const candidates: (Candidate & { isEpisodeCard?: boolean })[] = [];
      const seen = new Set<string>();

      const qNorm = normalizeArabic(trimmed).toLowerCase();
      const qWords = qNorm.split(/[\s:\-_]+/).filter((w) => w.length >= 2);

      while ((am = anchorRegex.exec(html)) !== null) {
        let href = am[1].trim();
        if (href.startsWith("/")) href = `${EGYDEAD_BASE}${href}`;
        if (!href.startsWith("http")) continue;
        if (!href.includes("egydead")) continue;
        if (SKIP_PATH.test(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        const rawTitle = stripTags(am[2]);

        if (isDubbed(rawTitle)) continue;
        if (!rawTitle || rawTitle.length < 2) continue;
        // Skip nav/chrome links whose text is not a title.
        if (/^(الرئيسية|بحث|تسجيل|دخول|اتصل بنا|فئات|أفلام|مسلسلات|انمي)$/i.test(rawTitle)) continue;

        const tNorm = normalizeArabic(rawTitle).toLowerCase();
        const matchesWord = qWords.some((w) => tNorm.includes(w));
        const sim = computeSimilarity(trimmed, rawTitle);
        if (!matchesWord && sim < 0.4) continue;

        const kind: MediaKind = isSeriesTitle(rawTitle) ? "series" : "movie";
        if (targetKind && targetKind !== kind) continue;

        // Poster: an <img> near this anchor on the search page.
        const snippet = html.slice(Math.max(0, am.index - 600), am.index + 600);
        const imgMatch = snippet.match(/<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i);
        const poster = imgMatch ? imgMatch[1] : undefined;

        const cleaned = cleanTitle(rawTitle);
        const year = parseYear(rawTitle);
        const epCard = isEpisodeCard(rawTitle);

        candidates.push({
          id: `egydead:${slugOf(href)}`,
          title: cleaned,
          url: href,
          kind,
          poster,
          year,
          site: this.id,
          siteLabel: this.label,
          similarity: sim + (epCard ? 0 : 0.25),
          isEpisodeCard: epCard,
        });
      }

      candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

      // Main title pages first; episode cards only fill the list up.
      const finalResults: Candidate[] = [];
      let hasMain = false;
      for (const c of candidates) {
        if (!c.isEpisodeCard) {
          hasMain = true;
          finalResults.push(c);
        }
      }
      for (const c of candidates) {
        if (c.isEpisodeCard) {
          if (!hasMain || finalResults.length < 6) {
            finalResults.push(c);
          }
        }
        if (finalResults.length >= 10) break;
      }

      return finalResults;
    } catch (e: any) {
      console.error("EgyDead search error:", e.message);
      return [];
    }
  }

  async getDetails(candidate: Candidate): Promise<MediaDetails> {
    try {
      const res = await fetch(candidate.url, { headers: egydeadHeaders(), signal: AbortSignal.timeout(6000) });
      const html = await res.text();

      const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
      const thumbMatch = html.match(/<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i);
      const poster = ogMatch ? ogMatch[1] : thumbMatch ? thumbMatch[1] : candidate.poster;

      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? cleanTitle(titleMatch[1]) : candidate.title;

      const seasons: SeasonGroup[] = [];
      const sources: SourceLink[] = [];

      if (candidate.kind === "series") {
        const anchorRegex = /<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let am: RegExpExecArray | null;
        const episodes: Episode[] = [];
        const seenUrls = new Set<string>();

        while ((am = anchorRegex.exec(html)) !== null) {
          let href = am[1].trim();
          if (href.startsWith("/")) href = `${EGYDEAD_BASE}${href}`;
          if (!href.startsWith("http") || !href.includes("egydead")) continue;
          if (seenUrls.has(href)) continue;
          seenUrls.add(href);

          const text = stripTags(am[2]);
          const epMatch =
            text.match(/(?:الحلقة|حلقة|episode)[\s\-_.:/]*0*(\d{1,4})(?!\d)/i) ||
            href.match(/(?:الحلقة|حلقة|episode)[\s\-_.:/]*0*(\d{1,4})(?!\d)/i);
          if (!epMatch) continue;
          const epNum = Number(epMatch[1]);
          const seasonMatch =
            text.match(/(?:الموسم|موسم|season)[\s\-_.:/]*0*(\d{1,2})(?!\d)/i) ||
            href.match(/(?:الموسم|موسم|season)[\s\-_.:/]*0*(\d{1,2})(?!\d)/i);
          episodes.push({
            season: seasonMatch ? Number(seasonMatch[1]) : 1,
            episode: epNum,
            title: text || `الحلقة ${epNum}`,
            url: href,
          });
        }

        episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
        const bySeason = new Map<number, Episode[]>();
        for (const ep of episodes) {
          const list = bySeason.get(ep.season) || [];
          if (!list.some((e) => e.episode === ep.episode)) list.push(ep);
          bySeason.set(ep.season, list);
        }
        for (const [season, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
          seasons.push({ season, episodes: eps });
        }
      }

      // Stub qualities pointing at the watch page (same shape as EgyBest):
      // they fail validateDirectUrl, so they can never become a native stream.
      const watchUrl = candidate.url;
      sources.push({ name: "ايجي ديد 1080p FHD", url: watchUrl, quality: "1080p FHD", kind: "mp4" });
      sources.push({ name: "ايجي ديد 720p HD", url: watchUrl, quality: "720p HD", kind: "mp4" });
      sources.push({ name: "ايجي ديد 480p SD", url: watchUrl, quality: "480p SD", kind: "mp4" });

      return {
        candidate,
        title,
        poster,
        kind: candidate.kind,
        seasons,
        sources,
      };
    } catch {
      return {
        candidate,
        title: candidate.title,
        kind: candidate.kind,
        seasons: [],
        sources: [],
      };
    }
  }

  async getEpisodeSources(episode: Episode): Promise<SourceLink[]> {
    return [
      { name: "ايجي ديد 1080p FHD", url: episode.url, quality: "1080p FHD", kind: "mp4" },
      { name: "ايجي ديد 720p HD", url: episode.url, quality: "720p HD", kind: "mp4" },
      { name: "ايجي ديد 480p SD", url: episode.url, quality: "480p SD", kind: "mp4" },
    ];
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    // Search-only stub: returns the watch page itself, which
    // validateDirectUrl rejects — EgyDead never yields a native stream.
    return {
      quality: "720p HD",
      directVideoUrl: watchUrl,
      fileName: "video.mp4",
    };
  }
}
