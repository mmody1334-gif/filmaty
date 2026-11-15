import { cleanTitle, computeSimilarity, isRelevant, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, ResolvedStream, SourceLink } from "./types.ts";

export class FushaarProvider implements Provider {
  id = "fushaar";
  label = "فشار (أفلام هوليوود مترجمة)";
  kinds: MediaKind[] = ["movie"];

  private baseUrls = ["https://fushaar.com"];
  private currentBase = "https://fushaar.com";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    if (kind && kind !== "movie") return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    const searchUrl = `${this.currentBase}/?s=${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(searchUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const candidates: Candidate[] = [];
      const linkRegex = /<a\s+href="(https:\/\/fushaar\.com\/movie\/[^"]+)"[^>]*title="([^"]*)"/gi;
      let m;
      const seen = new Set<string>();

      while ((m = linkRegex.exec(html))) {
        const url = m[1];
        const rawTitle = m[2].trim();

        if (!rawTitle || seen.has(url)) continue;
        if (!isRelevant(rawTitle, trimmed)) continue;

        seen.add(url);

        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(trimmed, rawTitle);

        // Extract poster
        let poster: string | undefined;
        const posterMatch = html.slice(Math.max(0, m.index - 400), m.index + 400).match(/src="([^"]*(?:image|upload|wp-content)[^"]*)"/i);
        if (posterMatch) poster = posterMatch[1];

        candidates.push({
          id: `fushaar:${url.split("/").filter(Boolean).pop()}`,
          title: cleanTitle(rawTitle.replace(/مشاهدة وتحميل فلم/i, "")),
          url,
          kind: "movie",
          poster,
          year,
          site: this.id,
          siteLabel: this.label,
          similarity,
        });

        if (candidates.length >= 6) break;
      }

      return candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    } catch (err) {
      console.error("Fushaar search error:", err);
      return [];
    }
  }

  async getDetails(candidate: Candidate): Promise<MediaDetails> {
    try {
      const res = await fetch(candidate.url, {
        headers: this.headers,
        signal: AbortSignal.timeout(6000),
      });
      const html = await res.text();

      const sources: SourceLink[] = [];
      sources.push({
        name: "🎬 سيرفر فشار FHD (مترجم عربي)",
        url: candidate.url,
        quality: "1080p FHD",
        kind: "embed",
      });
      sources.push({
        name: "⚡️ سيرفر فشار 720p HD",
        url: candidate.url,
        quality: "720p HD",
        kind: "embed",
      });

      return {
        candidate,
        title: candidate.title,
        year: candidate.year,
        kind: "movie",
        poster: candidate.poster,
        seasons: [],
        sources,
      };
    } catch {
      return {
        candidate,
        title: candidate.title,
        kind: "movie",
        seasons: [],
        sources: [],
      };
    }
  }

  async getEpisodeSources(_episode: Episode): Promise<SourceLink[]> {
    return [];
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    return {
      quality: "720p HD",
      directVideoUrl: watchUrl,
      fileName: "fushaar-movie.mp4",
    };
  }
}
