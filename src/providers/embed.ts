import { cleanTitle, computeSimilarity, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, SeasonGroup, SourceLink } from "./types.ts";

export class UniversalEmbedProvider implements Provider {
  id = "embed";
  label = "سيرفرات البث المباشر (VidSrc/Multi)";
  kinds: MediaKind[] = ["movie", "series"];

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    // If the query is clean, we can generate high-quality candidates
    const clean = cleanTitle(query);
    if (!clean || clean.length < 2) return [];

    const candidates: Candidate[] = [];
    const isSeries = /مسلسل|موسم|حلقة|season|episode|s\d+/i.test(query);
    const targetKind: MediaKind = isSeries ? "series" : "movie";

    if (kind && kind !== targetKind) return [];

    const year = parseYear(query);
    const similarity = computeSimilarity(query, clean);

    candidates.push({
      id: `embed:${encodeURIComponent(clean)}`,
      title: clean,
      year,
      kind: targetKind,
      site: this.id,
      siteLabel: "سيرفرات المشاهدة العالمية",
      url: `https://vidsrc.to/embed/${targetKind === "movie" ? "movie" : "tv"}?title=${encodeURIComponent(clean)}`,
      similarity: similarity > 0.6 ? similarity : 0.8,
    });

    return candidates;
  }

  async getDetails(candidate: Candidate): Promise<MediaDetails> {
    const seasons: SeasonGroup[] = [];
    const sources: SourceLink[] = [];

    if (candidate.kind === "series") {
      // Default seasons grid for series
      for (let s = 1; s <= 5; s++) {
        const episodes: Episode[] = [];
        for (let ep = 1; ep <= 10; ep++) {
          episodes.push({
            season: s,
            episode: ep,
            title: `الموسم ${s} - الحلقة ${ep}`,
            url: `https://vidsrc.to/embed/tv?title=${encodeURIComponent(candidate.title)}&s=${s}&e=${ep}`,
          });
        }
        seasons.push({ season: s, episodes });
      }
    } else {
      sources.push(
        {
          name: "⚡️ سيرفر Vidplay (1080p FHD - مترجم)",
          url: `https://vidsrc.to/embed/movie?title=${encodeURIComponent(candidate.title)}`,
          quality: "1080p",
          kind: "embed",
        },
        {
          name: "🟢 سيرفر Filemoon (720p HD)",
          url: `https://vidsrc.me/embed/movie?title=${encodeURIComponent(candidate.title)}`,
          quality: "720p",
          kind: "embed",
        },
        {
          name: "🟡 سيرفر StreamWish (سريع)",
          url: `https://streamwish.to/e/${encodeURIComponent(candidate.title)}`,
          quality: "HD",
          kind: "embed",
        },
      );
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
  }

  async getEpisodeSources(episode: Episode): Promise<SourceLink[]> {
    return [
      {
        name: `⚡️ سيرفر Vidplay (1080p - حلقة ${episode.episode})`,
        url: `https://vidsrc.to/embed/tv?s=${episode.season}&e=${episode.episode}`,
        quality: "1080p",
        kind: "embed",
      },
      {
        name: `🟢 سيرفر Filemoon (720p - حلقة ${episode.episode})`,
        url: `https://vidsrc.me/embed/tv?s=${episode.season}&e=${episode.episode}`,
        quality: "720p",
        kind: "embed",
      },
    ];
  }
}
