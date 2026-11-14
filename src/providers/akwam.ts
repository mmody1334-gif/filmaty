import { cleanTitle, computeSimilarity, parseQuality, parseSeasonEpisode, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, SeasonGroup, SourceLink } from "./types.ts";

export class AkwamProvider implements Provider {
  id = "akwam";
  label = "أكوام";
  kinds: MediaKind[] = ["movie", "series"];

  private baseUrls = ["https://akwam.cx", "https://akwam.to", "https://akwam.im"];
  private currentBase = "https://akwam.cx";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const searchUrl = `${this.currentBase}/search?q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(searchUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const candidates: Candidate[] = [];
      const re = /<a\s+href="([^"]*(?:movie|series)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      const seen = new Set<string>();

      while ((m = re.exec(html))) {
        const url = m[1];
        if (seen.has(url)) continue;
        seen.add(url);

        const cardHtml = m[2];
        const titleMatch = cardHtml.match(/<h\d[^>]*>([^<]+)<\/h\d>/i) || cardHtml.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</i);
        const rawTitle = titleMatch ? titleMatch[1].trim() : cardHtml.replace(/<[^>]+>/g, "").trim();

        if (!rawTitle || rawTitle.length < 2) continue;

        const isSeries = url.includes("/series/") || rawTitle.includes("مسلسل");
        const detectedKind: MediaKind = isSeries ? "series" : "movie";

        if (kind && kind !== detectedKind) continue;

        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(query, rawTitle);

        let poster: string | undefined;
        const posterMatch = cardHtml.match(/src="([^"]+\.(?:jpg|png|webp)[^"]*)"/i);
        if (posterMatch) poster = posterMatch[1];

        candidates.push({
          id: `akwam:${url.split("/").filter(Boolean).pop()}`,
          title: cleanTitle(rawTitle),
          year,
          kind: detectedKind,
          site: this.id,
          siteLabel: this.label,
          url: url.startsWith("http") ? url : `${this.currentBase}/${url.replace(/^\//, "")}`,
          poster,
          similarity,
        });
      }

      return candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    } catch (err) {
      console.error("Akwam search error:", err);
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

      const seasons: SeasonGroup[] = [];
      const sources: SourceLink[] = [];

      if (candidate.kind === "series") {
        // Find episode links
        const epLinks = [...html.matchAll(/<a\s+href="([^"]*\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
        const episodes: Episode[] = [];

        for (const ep of epLinks) {
          const epUrl = ep[1];
          const text = ep[2].replace(/<[^>]+>/g, "").trim();
          const se = parseSeasonEpisode(text);
          episodes.push({
            season: se.season || 1,
            episode: se.episode || episodes.length + 1,
            title: text || `الحلقة ${episodes.length + 1}`,
            url: epUrl.startsWith("http") ? epUrl : `${this.currentBase}/${epUrl.replace(/^\//, "")}`,
          });
        }

        seasons.push({ season: 1, episodes });
      } else {
        // Direct download and watch links
        const links = [...html.matchAll(/<a\s+href="([^"]*(?:watch|download)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
        for (const l of links) {
          const linkUrl = l[1];
          const text = l[2].replace(/<[^>]+>/g, "").trim();
          const quality = parseQuality(text) || "HD";
          sources.push({
            name: `أكوام ${quality}`,
            url: linkUrl.startsWith("http") ? linkUrl : `${this.currentBase}/${linkUrl.replace(/^\//, "")}`,
            quality,
            kind: linkUrl.includes(".mp4") ? "mp4" : "embed",
            referer: candidate.url,
          });
        }
      }

      return {
        candidate,
        title: candidate.title,
        year: candidate.year,
        kind: candidate.kind,
        poster: candidate.poster,
        seasons,
        sources,
      };
    } catch (err) {
      console.error("Akwam getDetails error:", err);
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
    try {
      const res = await fetch(episode.url, { headers: this.headers, signal: AbortSignal.timeout(5000) });
      const html = await res.text();
      const sources: SourceLink[] = [];

      const links = [...html.matchAll(/<a\s+href="([^"]*(?:watch|download)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
      for (const l of links) {
        const linkUrl = l[1];
        const text = l[2].replace(/<[^>]+>/g, "").trim();
        const quality = parseQuality(text) || "HD";
        sources.push({
          name: `أكوام ${quality}`,
          url: linkUrl.startsWith("http") ? linkUrl : `${this.currentBase}/${linkUrl.replace(/^\//, "")}`,
          quality,
          kind: linkUrl.includes(".mp4") ? "mp4" : "embed",
          referer: episode.url,
        });
      }
      return sources;
    } catch {
      return [];
    }
  }
}
