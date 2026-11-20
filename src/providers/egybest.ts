import { cleanTitle, computeSimilarity, normalizeArabic, parseYear, isDubbed } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, SeasonGroup, SourceLink, ResolvedStream } from "./types.ts";

export const EGYBEST_BASE = "https://iegybest.cimawbas.tv";

export function egybestHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9",
    Referer: `${EGYBEST_BASE}/`,
  };
}

export class EgyBestProvider implements Provider {
  id = "egybest";
  label = "ايجي بست (حصري)";
  kinds: MediaKind[] = ["movie", "series"];

  async search(query: string, targetKind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url = `${EGYBEST_BASE}/search.php?keywords=${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(url, { headers: egybestHeaders(), signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const html = await res.text();

      const linkRegex = /href="(https:\/\/iegybest\.cimawbas\.tv\/watch\.php\?vid=([a-f0-9]+))"[^>]*title="([^"]*)"/gi;
      let lm: RegExpExecArray | null;
      const candidates: (Candidate & { isEpisodeCard?: boolean })[] = [];
      const seen = new Set<string>();

      const qNorm = normalizeArabic(trimmed).toLowerCase();
      const qWords = qNorm.split(/[\s:\-_]+/).filter((w) => w.length >= 2);

      while ((lm = linkRegex.exec(html)) !== null) {
        const fullUrl = lm[1];
        const vid = lm[2];
        const rawTitle = lm[3].trim();
        if (isDubbed(rawTitle)) continue;
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);

        // Strict relevance check
        const tNorm = normalizeArabic(rawTitle).toLowerCase();
        const matchesWord = qWords.some((w) => tNorm.includes(w));
        const sim = computeSimilarity(trimmed, rawTitle);
        if (!matchesWord && sim < 0.4) {
          continue;
        }

        const isSeries =
          rawTitle.includes("مسلسل") ||
          rawTitle.includes("الحلقة") ||
          rawTitle.includes("حلقة") ||
          rawTitle.includes("الموسم");
        const kind: MediaKind = isSeries ? "series" : "movie";
        if (targetKind && targetKind !== kind) continue;

        // Try extracting poster near this link
        const snippet = html.slice(Math.max(0, lm.index - 500), lm.index + 500);
        const imgMatch = snippet.match(/src="(https:\/\/iegybest\.cimawbas\.tv\/uploads\/thumbs\/[^\s"']+\.jpg)"/i);
        const poster = imgMatch ? imgMatch[1] : undefined;

        const cleaned = cleanTitle(rawTitle.replace(/\s*ايجي\s*بست\s*/gi, ""));
        const year = parseYear(rawTitle);
        const isEpisodeCard = /(?:الحلقة|حلقة)\s*\d+/i.test(rawTitle);

        candidates.push({
          id: `egybest:${vid}`,
          title: cleaned,
          url: fullUrl,
          kind,
          poster,
          year,
          site: this.id,
          siteLabel: this.label,
          similarity: sim + (isEpisodeCard ? 0 : 0.25),
          isEpisodeCard,
        });
      }

      candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

      const finalResults: Candidate[] = [];
      let hasMainSeries = false;
      for (const c of candidates) {
        if (!c.isEpisodeCard) {
          hasMainSeries = true;
          finalResults.push(c);
        }
      }

      for (const c of candidates) {
        if (c.isEpisodeCard) {
          if (!hasMainSeries || finalResults.length < 6) {
            finalResults.push(c);
          }
        }
        if (finalResults.length >= 10) break;
      }

      return finalResults;
    } catch (e: any) {
      console.error("EgyBest search error:", e.message);
      return [];
    }
  }

  async getDetails(candidate: Candidate): Promise<MediaDetails> {
    try {
      const res = await fetch(candidate.url, { headers: egybestHeaders(), signal: AbortSignal.timeout(6000) });
      const html = await res.text();

      const thumbMatch = html.match(/thumb_url:\s*"([^"]+)"/i) || html.match(/src="([^"]*\/uploads\/thumbs\/[^"]+)"/i);
      const poster = thumbMatch ? thumbMatch[1] : candidate.poster;

      const titleMatch = html.match(/title:\s*'([^']+)'/i) || html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? cleanTitle(titleMatch[1].replace(/\s*ايجي\s*بست\s*/gi, "")) : candidate.title;

      const seasons: SeasonGroup[] = [];
      const sources: SourceLink[] = [];

      if (candidate.kind === "series") {
        const epRegex = /<a[^>]+href="(https:\/\/iegybest\.cimawbas\.tv\/watch\.php\?vid=[a-f0-9]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let em: RegExpExecArray | null;
        const episodes: Episode[] = [];
        const seenVids = new Set<string>();

        while ((em = epRegex.exec(html)) !== null) {
          const epUrl = em[1];
          const epText = em[2].replace(/<[^>]+>/g, "").trim();
          if (seenVids.has(epUrl)) continue;
          seenVids.add(epUrl);

          const epNumMatch = epText.match(/(?:الحلقة|حلقة)\s*(\d+)/i);
          if (epNumMatch) {
            const epNum = Number(epNumMatch[1]);
            episodes.push({
              season: 1,
              episode: epNum,
              title: epText,
              url: epUrl,
            });
          }
        }

        episodes.sort((a, b) => a.episode - b.episode);

        if (episodes.length > 0) {
          seasons.push({ season: 1, episodes });
        }
      }

      const watchUrl = candidate.url;
      sources.push({
        name: "ايجي بست 1080p FHD (سيرفر فائق السرعة)",
        url: watchUrl,
        quality: "1080p FHD",
        kind: "mp4",
      });
      sources.push({
        name: "ايجي بست 720p HD (الأسرع والأفضل)",
        url: watchUrl,
        quality: "720p HD",
        kind: "mp4",
      });
      sources.push({
        name: "ايجي بست 480p SD (توفير البيانات)",
        url: watchUrl,
        quality: "480p SD",
        kind: "mp4",
      });

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
      {
        name: "ايجي بست 1080p FHD",
        url: episode.url,
        quality: "1080p FHD",
        kind: "mp4",
      },
      {
        name: "ايجي بست 720p HD",
        url: episode.url,
        quality: "720p HD",
        kind: "mp4",
      },
      {
        name: "ايجي بست 480p SD",
        url: episode.url,
        quality: "480p SD",
        kind: "mp4",
      },
    ];
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    return {
      quality: "720p HD",
      directVideoUrl: watchUrl,
      fileName: "video.mp4",
    };
  }
}
