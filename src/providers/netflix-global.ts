import { cleanTitle, computeSimilarity, normalizeArabic, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, ResolvedStream, SeasonGroup, SourceLink } from "./types.ts";

const TMDB_API_KEY = "15d2ea6d0dc1d476efbca3eba2b9bbfb";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

interface TmdbItem {
  id: number;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  media_type?: string;
  first_air_date?: string;
  release_date?: string;
  vote_average?: number;
}

export class NetflixGlobalProvider implements Provider {
  id = "netflix_global";
  label = "نتفليكس والمسلسلات العالمية 🌐";
  kinds: MediaKind[] = ["movie", "series"];

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const candidates: Candidate[] = [];
    const seenIds = new Set<string>();

    // Search in Arabic and English in parallel
    const searchUrls = [
      `${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(trimmed)}&language=ar&include_adult=false`,
      `${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(trimmed)}&language=en-US&include_adult=false`,
    ];

    try {
      const responses = await Promise.allSettled(
        searchUrls.map((u) => fetch(u, { signal: AbortSignal.timeout(5000) })),
      );

      for (const res of responses) {
        if (res.status !== "fulfilled" || !res.value.ok) continue;
        const data = (await res.value.json()) as { results?: TmdbItem[] };
        if (!Array.isArray(data.results)) continue;

        for (const item of data.results) {
          if (!item.id) continue;
          const mediaType = item.media_type;
          if (mediaType !== "tv" && mediaType !== "movie") continue;

          const detectedKind: MediaKind = mediaType === "tv" ? "series" : "movie";
          if (kind && kind !== detectedKind) continue;

          const idKey = `tmdb_${detectedKind}_${item.id}`;
          if (seenIds.has(idKey)) continue;
          seenIds.add(idKey);

          const arabicName = item.name || item.title || "";
          const origName = item.original_name || item.original_title || "";
          const dateStr = item.first_air_date || item.release_date || "";
          const year = parseYear(dateStr) || (dateStr ? Number(dateStr.slice(0, 4)) : undefined);

          let displayTitle = arabicName;
          if (origName && origName.toLowerCase() !== arabicName.toLowerCase()) {
            displayTitle = `${arabicName} (${origName})`;
          }

          const poster = item.poster_path ? `${TMDB_IMG}${item.poster_path}` : undefined;
          const similarity = Math.max(
            computeSimilarity(trimmed, arabicName),
            computeSimilarity(trimmed, origName),
          );

          candidates.push({
            id: `netflix:${detectedKind}:${item.id}`,
            title: displayTitle,
            url: `https://www.themoviedb.org/${detectedKind === "series" ? "tv" : "movie"}/${item.id}`,
            kind: detectedKind,
            poster,
            year,
            rating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
            site: this.id,
            siteLabel: this.label,
            similarity: similarity + 0.1, // High quality catalog boost
          });

          if (candidates.length >= 8) break;
        }
      }

      return candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    } catch (err) {
      console.error("NetflixGlobal search error:", err);
      return [];
    }
  }

  async getDetails(candidate: Candidate): Promise<MediaDetails> {
    const parts = candidate.id.split(":");
    const kind = parts[1] as MediaKind;
    const tmdbId = parts[2];

    const typePath = kind === "series" ? "tv" : "movie";
    const detailUrl = `${TMDB_BASE}/${typePath}/${tmdbId}?api_key=${TMDB_API_KEY}&language=ar`;

    try {
      const res = await fetch(detailUrl, { signal: AbortSignal.timeout(6000) });
      const data = (await res.json()) as any;

      const poster = data.poster_path ? `${TMDB_IMG}${data.poster_path}` : candidate.poster;
      const title = data.name || data.title || candidate.title;
      const description = data.overview || "";
      const year = candidate.year;
      const rating = data.vote_average ? data.vote_average.toFixed(1) : candidate.rating;

      const seasons: SeasonGroup[] = [];
      const sources: SourceLink[] = [];

      if (kind === "series" && Array.isArray(data.seasons)) {
        // Fetch seasons details
        for (const s of data.seasons) {
          if (s.season_number === 0) continue; // Skip specials by default
          const epCount = s.episode_count || 1;
          const episodes: Episode[] = [];

          for (let ep = 1; ep <= epCount; ep++) {
            episodes.push({
              season: s.season_number,
              episode: ep,
              title: `الموسم ${s.season_number} - الحلقة ${ep}`,
              url: `tmdb:${tmdbId}:${s.season_number}:${ep}`,
            });
          }

          if (episodes.length > 0) {
            seasons.push({ season: s.season_number, episodes });
          }
        }
      } else {
        // Movie: provide 4 high-speed multi-quality streaming servers
        sources.push({
          name: "⚡️ سيرفر VidLink Pro (فائق السرعة FHD)",
          url: `https://vidlink.pro/movie/${tmdbId}`,
          quality: "1080p FHD",
          kind: "embed",
        });
        sources.push({
          name: "🎬 سيرفر VidSrc العالمي (Full HD مع ترجمة)",
          url: `https://vidsrc.to/embed/movie/${tmdbId}`,
          quality: "1080p FHD",
          kind: "embed",
        });
        sources.push({
          name: "🚀 سيرفر MultiEmbed (متعدد الجودات 720p)",
          url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`,
          quality: "720p HD",
          kind: "embed",
        });
        sources.push({
          name: "📱 سيرفر 2Embed (مشغل سريع ومستقر)",
          url: `https://www.2embed.cc/embed/${tmdbId}`,
          quality: "480p SD",
          kind: "embed",
        });
      }

      return {
        candidate,
        title,
        year,
        rating,
        poster,
        description,
        kind,
        seasons,
        sources,
      };
    } catch (err) {
      console.error("NetflixGlobal getDetails error:", err);
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
    // episode.url format: tmdb:{tmdbId}:{season}:{episode}
    const parts = episode.url.split(":");
    const tmdbId = parts[1] || "";
    const s = episode.season;
    const e = episode.episode;

    return [
      {
        name: "⚡️ سيرفر VidLink Pro (فائق السرعة FHD)",
        url: `https://vidlink.pro/tv/${tmdbId}/${s}/${e}`,
        quality: "1080p FHD",
        kind: "embed",
      },
      {
        name: "🎬 سيرفر VidSrc العالمي (Full HD مع ترجمة)",
        url: `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`,
        quality: "1080p FHD",
        kind: "embed",
      },
      {
        name: "🚀 سيرفر MultiEmbed (متعدد الجودات 720p)",
        url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`,
        quality: "720p HD",
        kind: "embed",
      },
      {
        name: "📱 سيرفر 2Embed (مشغل سريع ومستقر)",
        url: `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`,
        quality: "480p SD",
        kind: "embed",
      },
    ];
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    return {
      quality: "1080p FHD",
      directVideoUrl: watchUrl,
      fileName: "netflix-stream.mp4",
    };
  }
}
