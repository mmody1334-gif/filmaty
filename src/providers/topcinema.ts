import { cleanTitle, computeSimilarity, isRelevant, parseSeasonEpisode, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, ResolvedStream, SeasonGroup, SourceLink } from "./types.ts";

export class TopCinemaProvider implements Provider {
  id = "topcinema";
  label = "توب سينما (مسلسلات نتفليكس وأفلام عالمية)";
  kinds: MediaKind[] = ["movie", "series"];

  private baseUrls = ["https://topcinemaa.one", "https://topcinema.top"];
  private currentBase = "https://topcinemaa.one";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const searchUrl = `${this.currentBase}/search/?query=${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(searchUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const candidates: Candidate[] = [];
      const linkRegex = /<a[^>]*href="([^"]*(?:topcinemaa\.one|topcinema\.top)[^"]*)"[^>]*title="([^"]*)"/gi;
      let m;
      const seen = new Set<string>();

      while ((m = linkRegex.exec(html))) {
        const url = m[1];
        const rawTitle = m[2].trim();

        if (!rawTitle || seen.has(url)) continue;
        if (url.includes("/category/") || url.includes("/tag/") || url.includes("/search/")) continue;
        if (!isRelevant(rawTitle, trimmed)) continue;

        seen.add(url);

        const isSeries = rawTitle.includes("مسلسل") || url.includes("/series/") || rawTitle.includes("الموسم") || rawTitle.includes("الحلقة");
        const detectedKind: MediaKind = isSeries ? "series" : "movie";

        if (kind && kind !== detectedKind) continue;

        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(trimmed, rawTitle);

        // Extract poster if present near markup
        let poster: string | undefined;
        const posterMatch = html.slice(Math.max(0, m.index - 500), m.index + 500).match(/src="([^"]*(?:image|upload|thumb)[^"]*)"/i);
        if (posterMatch) poster = posterMatch[1];

        const se = parseSeasonEpisode(rawTitle + " " + decodeURIComponent(url));
        let title = cleanTitle(rawTitle);
        if (detectedKind === "series" && se.season && !title.includes(String(se.season))) {
          title = `${title} (الموسم ${se.season})`;
        }

        candidates.push({
          id: `topcinema:${url.split("/").filter(Boolean).pop()}`,
          title,
          url,
          kind: detectedKind,
          poster,
          year,
          site: this.id,
          siteLabel: this.label,
          similarity,
        });

        if (candidates.length >= 8) break;
      }

      return candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    } catch (err) {
      console.error("TopCinema search error:", err);
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
        // Extract episode links from series page
        const epMatches = [...html.matchAll(/<a\s+href="([^"]*(?:الحلقة|episode)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
        const episodes: Episode[] = [];

        for (const ep of epMatches) {
          const epUrl = ep[1];
          const text = ep[2].replace(/<[^>]+>/g, "").trim();
          const se = parseSeasonEpisode(text + " " + decodeURIComponent(epUrl));
          episodes.push({
            season: se.season || 1,
            episode: se.episode || episodes.length + 1,
            title: text || `الحلقة ${episodes.length + 1}`,
            url: epUrl,
          });
        }

        if (episodes.length > 0) {
          seasons.push({ season: 1, episodes });
        } else {
          seasons.push({
            season: 1,
            episodes: [{ season: 1, episode: 1, title: candidate.title, url: candidate.url }],
          });
        }
      } else {
        // Movie: watch and download links
        const watchUrl = `${candidate.url}watch/`;
        const dlUrl = `${candidate.url}download/`;

        sources.push({
          name: "⚡️ سيرفر توب سينما FHD",
          url: watchUrl,
          quality: "1080p FHD",
          kind: "embed",
          referer: candidate.url,
        });
        sources.push({
          name: "📥 سيرفر تحميل توب سينما",
          url: dlUrl,
          quality: "720p HD",
          kind: "embed",
          referer: candidate.url,
        });
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
    return [
      {
        name: "⚡️ سيرفر مشاهدة HD",
        url: `${episode.url}watch/`,
        quality: "720p HD",
        kind: "embed",
      },
      {
        name: "📥 سيرفر تحميل فوري",
        url: `${episode.url}download/`,
        quality: "720p HD",
        kind: "embed",
      },
    ];
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    return {
      quality: "720p HD",
      directVideoUrl: watchUrl,
      fileName: "topcinema-video.mp4",
    };
  }
}
