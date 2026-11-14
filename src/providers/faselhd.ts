import { cleanTitle, computeSimilarity, parseSeasonEpisode, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, SeasonGroup, SourceLink } from "./types.ts";

export class FaselHdProvider implements Provider {
  id = "faselhd";
  label = "فاصل HD";
  kinds: MediaKind[] = ["movie", "series"];

  private baseUrls = ["https://faselhd.online", "https://web.faselhd.link"];
  private currentBase = "https://faselhd.online";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const searchUrl = `${this.currentBase}/?s=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(searchUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const candidates: Candidate[] = [];
      const re = /href="(https:\/\/faselhd\.online\/([^"\/]+)\/)"/gi;
      let m;
      const seen = new Set<string>();

      while ((m = re.exec(html))) {
        const fullUrl = m[1];
        const slug = decodeURIComponent(m[2]);

        if (seen.has(fullUrl)) continue;
        if (!slug.startsWith("فيلم-") && !slug.startsWith("مسلسل-") && !slug.startsWith("سلسلة-")) continue;

        seen.add(fullUrl);

        const isSeries = slug.startsWith("مسلسل-");
        const detectedKind: MediaKind = isSeries ? "series" : "movie";

        if (kind && kind !== detectedKind) continue;

        const rawTitle = slug.replace(/-/g, " ");
        const title = cleanTitle(rawTitle);
        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(query, rawTitle);

        // Poster matching near this slug
        let poster: string | undefined;
        const posterMatch = html.slice(Math.max(0, m.index - 500), m.index + 500).match(/src="([^"]+\.webp[^"]*)"/i);
        if (posterMatch) poster = posterMatch[1];

        candidates.push({
          id: `faselhd:${m[2]}`,
          title,
          year,
          kind: detectedKind,
          site: this.id,
          siteLabel: this.label,
          url: fullUrl,
          poster,
          similarity,
        });
      }

      return candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    } catch (err) {
      console.error("FaselHD search error:", err);
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
        // Extract seasons and episodes list from FaselHD series page
        const seasonBlocks = [...html.matchAll(/class="[^"]*season[^"]*"[\s\S]*?<\/div>/gi)];
        let seasonNum = 1;

        const epLinks = [...html.matchAll(/href="(https:\/\/faselhd\.online\/[^"\/]*الحلقة-[^"\/]*\/)"/gi)];
        const episodes: Episode[] = [];

        for (const ep of epLinks) {
          const epUrl = ep[1];
          const decoded = decodeURIComponent(epUrl);
          const se = parseSeasonEpisode(decoded);
          episodes.push({
            season: se.season || seasonNum,
            episode: se.episode || episodes.length + 1,
            title: cleanTitle(decoded.replace(/https:\/\/faselhd\.online\/|\//g, "").replace(/-/g, " ")),
            url: epUrl,
          });
        }

        if (episodes.length > 0) {
          seasons.push({ season: seasonNum, episodes });
        } else {
          seasons.push({
            season: 1,
            episodes: [{ season: 1, episode: 1, title: candidate.title, url: candidate.url }],
          });
        }
      } else {
        // Movie: extract servers from FaselHD movie page
        const serverButtons = [...html.matchAll(/class="[^"]*cinema-server[^"]*"[^>]*data-embed="(\d+)"[^>]*>[\s\S]*?<span class="name"[^>]*>([^<]+)<\/span>/gi)];
        for (const btn of serverButtons) {
          const embedId = btn[1];
          const name = btn[2].trim();
          sources.push({
            name: `سيرفر ${name}`,
            url: `${this.currentBase}/watch?embed=${embedId}`,
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
    } catch (err) {
      console.error("FaselHD getDetails error:", err);
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
      if (!res.ok) return [];
      const html = await res.text();
      const sources: SourceLink[] = [];

      const serverButtons = [...html.matchAll(/class="[^"]*cinema-server[^"]*"[^>]*data-embed="(\d+)"[^>]*>[\s\S]*?<span class="name"[^>]*>([^<]+)<\/span>/gi)];
      for (const btn of serverButtons) {
        const embedId = btn[1];
        const name = btn[2].trim();
        sources.push({
          name: `سيرفر ${name}`,
          url: `${this.currentBase}/watch?embed=${embedId}`,
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
