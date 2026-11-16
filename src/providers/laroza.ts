import { cleanTitle, computeSimilarity, isRelevant, parseQuality, parseSeasonEpisode, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, ResolvedStream, SeasonGroup, SourceLink } from "./types.ts";

export class LarozaProvider implements Provider {
  id = "laroza";
  label = "لاروزا";
  kinds: MediaKind[] = ["movie", "series"];

  // Live domain first: laroza1.quest/.site/.lol all 301-redirect (to
  // laroza1.website, which 301s again), while laroza1.bond serves the
  // search/details/play/download pages directly (verified 2026-11-16).
  // The old bases made the provider silently return nothing from the
  // Worker, so titles only Laroza had (e.g. VisionQuest S1E1's working
  // copy) never resolved.
  private baseUrls = ["https://laroza1.bond", "https://laroza1.website", "https://laroza1.quest", "https://laroza1.site", "https://laroza.lol"];
  private currentBase = "https://laroza1.bond";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const searchUrl = `${this.currentBase}/search.php?keywords=${encodeURIComponent(trimmed)}`;
    try {
      const res = await fetch(searchUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const candidates: Candidate[] = [];
      const re = /<a\s+href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      const seen = new Set<string>();

      while ((m = re.exec(html))) {
        const url = m[1];
        const rawTitle = m[2] || m[3].replace(/<[^>]+>/g, "").trim();

        if (!rawTitle || rawTitle.includes("ابحث") || seen.has(url)) continue;
        if (!url.includes("video.php") && !url.includes("view-serie") && !url.includes("/video/")) continue;
        if (!isRelevant(rawTitle, trimmed)) continue;

        seen.add(url);

        const isSeries =
          rawTitle.includes("مسلسل") ||
          rawTitle.includes("الموسم") ||
          rawTitle.includes("الحلقة") ||
          url.includes("view-serie");
        const detectedKind: MediaKind = isSeries ? "series" : "movie";

        if (kind && kind !== detectedKind) continue;

        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(trimmed, rawTitle);

        // Extract poster if present in markup
        let poster: string | undefined;
        const posterMatch = html.slice(m.index, m.index + 800).match(/data-original-thumbnail="([^"]+)"|src="([^"]+)"/);
        if (posterMatch) {
          poster = posterMatch[1] || posterMatch[2];
        }

        candidates.push({
          id: `laroza:${extractVidOrSer(url)}`,
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
      console.error("Laroza search error:", err);
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

      // Check if this is a series with multiple seasons/episodes
      if (candidate.kind === "series") {
        const seasonListMatch = html.match(/<ul[^>]*aria-label="اختيار الموسم"[\s\S]*?<\/ul>/i);
        if (seasonListMatch) {
          const seasonItems = [...seasonListMatch[0].matchAll(/<li[^>]*data-serie="(\d+)"[^>]*>[\s\S]*?الموسم\s*(\d+)[\s\S]*?<\/li>/gi)];
          for (const s of seasonItems) {
            const seasonNum = Number(s[1] || s[2]);
            // Extract episodes for this season from page
            const episodes = extractEpisodesFromHtml(html, seasonNum, this.currentBase);
            if (episodes.length > 0) {
              seasons.push({ season: seasonNum, episodes });
            }
          }
        }

        // If no explicit season tabs found, this page is a single video
        // page. Its episode number lives in the page <title>/<h1>
        // ("... الحلقة 4"), not in the bare candidate title — never
        // assume episode 1: a bare "Dexter" title once resolved to an
        // episode-4 file as if it were episode 1. Fabricate the episode
        // only when its number is actually known (title or page title);
        // otherwise leave seasons empty so the resolver skips this
        // candidate instead of guessing.
        if (seasons.length === 0) {
          const pageTitle =
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
            html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
            "";
          const ep = parseSeasonEpisode(
            candidate.title + " " + pageTitle.replace(/<[^>]+>/g, " "),
          );
          if (ep.episode !== undefined) {
            seasons.push({
              season: ep.season || 1,
              episodes: [
                {
                  season: ep.season || 1,
                  episode: ep.episode,
                  title: candidate.title,
                  url: candidate.url,
                },
              ],
            });
          }
        }
      } else {
        // Movie: extract servers directly
        const vid = extractVidOrSer(candidate.url);
        if (vid) {
          const pageSources = await this.extractServersForVid(vid);
          sources.push(...pageSources);
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
      console.error("Laroza getDetails error:", err);
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
    const vid = extractVidOrSer(episode.url);
    if (!vid) return [];
    return this.extractServersForVid(vid);
  }

  private async extractServersForVid(vid: string): Promise<SourceLink[]> {
    const sources: SourceLink[] = [];
    const playUrl = `${this.currentBase}/play.php?vid=${vid}`;
    const dlUrl = `${this.currentBase}/download.php?vid=${vid}`;

    try {
      const [playRes, dlRes] = await Promise.all([
        fetch(playUrl, { headers: this.headers, signal: AbortSignal.timeout(5000) }),
        fetch(dlUrl, { headers: this.headers, signal: AbortSignal.timeout(5000) }),
      ]);

      if (dlRes.ok) {
        const dlHtml = await dlRes.text();
        // Extract direct MP4 download link
        const directMp4Match = dlHtml.match(/href="([^"]+\.mp4[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
        if (directMp4Match) {
          const url = directMp4Match[1].replace(/&amp;/g, "&");
          const text = directMp4Match[2].replace(/<[^>]+>/g, " ").trim();
          const quality = parseQuality(text) || "720p";
          const sizeMatch = text.match(/\b\d+(?:\.\d+)?\s*(?:MB|GB)\b/i);

          sources.push({
            name: `سيرفر مباشر (${quality})`,
            url,
            quality,
            kind: "mp4",
            referer: this.currentBase,
            downloadUrl: url,
            fileSize: sizeMatch ? sizeMatch[0] : undefined,
          });
        }

        // Extract cloud download links (voe.sx, mixdrop, usersdrive, vk, etc.)
        const cloudLinks = [...dlHtml.matchAll(/href="([^"]*(?:voe\.sx|dsvplay|mixdrop|vk\.com|uploady|1cloudfile|usersdrive|multiup)[^"]*)"/gi)];
        for (const cl of cloudLinks) {
          const u = cl[1].trim();
          sources.push({
            name: `تحميل سحابي (${extractHost(u)})`,
            url: u,
            quality: "720p",
            kind: "embed",
            downloadUrl: u,
          });
        }
      }

      if (playRes.ok) {
        const playHtml = await playRes.text();
        // Extract WatchList embed servers
        const embedMatches = [...playHtml.matchAll(/data-embed-url="([^"]+)"[^>]*>[\s\S]*?<strong>\s*([^<]+)\s*<\/strong>/gi)];
        for (const em of embedMatches) {
          const serverUrl = em[1].replace(/&amp;/g, "&");
          const serverName = em[2].trim();
          sources.push({
            name: serverName || `سيرفر ${extractHost(serverUrl)}`,
            url: serverUrl,
            quality: "HD",
            kind: "embed",
            referer: this.currentBase,
          });
        }
      }
    } catch (err) {
      console.error("Laroza extractServers error:", err);
    }

    return sources;
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    const vid = extractVidOrSer(watchUrl);
    if (vid) {
      const servers = await this.extractServersForVid(vid);
      const direct = servers.find((s) => s.kind === "mp4" && s.downloadUrl);
      if (direct?.downloadUrl) {
        return {
          quality: direct.quality || "720p HD",
          size: direct.fileSize,
          directVideoUrl: direct.downloadUrl,
          fileName: "laroza-video.mp4",
        };
      }
      const cloud = servers.find((s) => s.downloadUrl);
      if (cloud?.downloadUrl) {
        return {
          quality: cloud.quality || "720p HD",
          directVideoUrl: cloud.downloadUrl,
          fileName: "laroza-video.mp4",
        };
      }
    }
    return {
      quality: "720p HD",
      directVideoUrl: watchUrl,
      fileName: "laroza-video.mp4",
    };
  }
}

function extractVidOrSer(url: string): string {
  const match = url.match(/[?&](?:vid|ser)=([a-z0-9]+)/i);
  if (match) return match[1];
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function extractHost(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

function extractEpisodesFromHtml(html: string, seasonNum: number, base: string): Episode[] {
  const episodes: Episode[] = [];
  const re = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const seen = new Set<string>();

  while ((m = re.exec(html))) {
    const url = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").trim();

    if (!url.includes("video.php?vid=") || seen.has(url)) continue;
    seen.add(url);

    const se = parseSeasonEpisode(text);
    if (se.season && se.season !== seasonNum) continue;

    episodes.push({
      season: seasonNum,
      episode: se.episode || episodes.length + 1,
      title: text || `الحلقة ${episodes.length + 1}`,
      url: url.startsWith("http") ? url : `${base}/${url.replace(/^\//, "")}`,
    });
  }

  return episodes.sort((a, b) => a.episode - b.episode);
}
