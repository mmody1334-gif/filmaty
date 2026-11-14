import { cleanTitle, computeSimilarity, parseSeasonEpisode, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, SeasonGroup, SourceLink } from "./types.ts";

export class MyCimaProvider implements Provider {
  id = "mycima";
  label = "ماي سيما";
  kinds: MediaKind[] = ["movie", "series"];

  private baseUrls = ["https://wecima.movie", "https://wecima.show", "https://wecima.click"];
  private currentBase = "https://wecima.movie";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const searchUrl = `${this.currentBase}/search/${encodeURIComponent(query)}/`;
    try {
      const res = await fetch(searchUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const candidates: Candidate[] = [];
      const re = /<div class="GridItem"[\s\S]*?<a\s+href="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<\/div>/gi;
      let m;

      while ((m = re.exec(html))) {
        const itemHtml = m[0];
        const url = m[1];
        const rawTitle = m[2] || "";

        if (!rawTitle) continue;

        const isSeries = rawTitle.includes("مسلسل") || url.includes("/series/");
        const detectedKind: MediaKind = isSeries ? "series" : "movie";

        if (kind && kind !== detectedKind) continue;

        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(query, rawTitle);

        let poster: string | undefined;
        const posterMatch = itemHtml.match(/data-url="([^"]+)"|src="([^"]+)"/i);
        if (posterMatch) poster = posterMatch[1] || posterMatch[2];

        candidates.push({
          id: `mycima:${url.split("/").filter(Boolean).pop()}`,
          title: cleanTitle(rawTitle),
          year,
          kind: detectedKind,
          site: this.id,
          siteLabel: this.label,
          url,
          poster,
          similarity,
        });
      }

      return candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    } catch (err) {
      console.error("MyCima search error:", err);
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
        const epLinks = [...html.matchAll(/<a\s+href="([^"]*\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
        const episodes: Episode[] = [];

        for (const ep of epLinks) {
          const epUrl = ep[1];
          const text = ep[2].replace(/<[^>]+>/g, "").trim();
          const se = parseSeasonEpisode(text);
          episodes.push({
            season: se.season || 1,
            episode: se.episode || episodes.length + 1,
            title: text,
            url: epUrl,
          });
        }
        seasons.push({ season: 1, episodes });
      } else {
        // Find watch servers in WeCima
        const btnServers = [...html.matchAll(/<btn[^>]*data-url="([^"]+)"[^>]*>([^<]+)<\/btn>/gi)];
        for (const btn of btnServers) {
          sources.push({
            name: `سيرفر ${btn[2].trim()}`,
            url: btn[1],
            quality: "HD",
            kind: "embed",
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
    try {
      const res = await fetch(episode.url, { headers: this.headers, signal: AbortSignal.timeout(5000) });
      const html = await res.text();
      const sources: SourceLink[] = [];

      const btnServers = [...html.matchAll(/<btn[^>]*data-url="([^"]+)"[^>]*>([^<]+)<\/btn>/gi)];
      for (const btn of btnServers) {
        sources.push({
          name: `سيرفر ${btn[2].trim()}`,
          url: btn[1],
          quality: "HD",
          kind: "embed",
          referer: episode.url,
        });
      }
      return sources;
    } catch {
      return [];
    }
  }
}
