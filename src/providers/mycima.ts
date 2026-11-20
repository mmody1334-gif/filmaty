import { cleanTitle, computeSimilarity, isRelevant, parseSeasonEpisode, parseYear, isDubbed } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, ResolvedStream, SeasonGroup, SourceLink } from "./types.ts";

export class MyCimaProvider implements Provider {
  id = "mycima";
  label = "ماي سيما";
  kinds: MediaKind[] = ["movie", "series"];

  private baseUrls = ["https://wecima.rentals", "https://wecima.rest", "https://wecima.show", "https://wecima.movie"];
  private currentBase = "https://wecima.rentals";

  private headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const searchUrl = `${this.currentBase}/search/${encodeURIComponent(trimmed)}/`;
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
        if (isDubbed(rawTitle)) continue;

        if (!rawTitle) continue;
        if (!isRelevant(rawTitle, trimmed)) continue;

        const isSeries = rawTitle.includes("مسلسل") || url.includes("/series/");
        const detectedKind: MediaKind = isSeries ? "series" : "movie";

        if (kind && kind !== detectedKind) continue;

        const year = parseYear(rawTitle);
        const similarity = computeSimilarity(trimmed, rawTitle);

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
        const episodes = this.extractSeriesEpisodes(html, candidate);
        const bySeason = new Map<number, Episode[]>();
        for (const ep of episodes) {
          const list = bySeason.get(ep.season) || [];
          if (!list.some((e) => e.episode === ep.episode)) list.push(ep);
          bySeason.set(ep.season, list);
        }
        for (const [season, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
          eps.sort((a, b) => a.episode - b.episode);
          seasons.push({ season, episodes: eps });
        }
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

  // Episode list for a series page. The current WeCima theme (v2.0.12,
  // live 2026-11-17) renders episodes as <episodetitle>الحلقة N</episodetitle>
  // anchors — NOT the old /episode/ URLs the previous code looked for,
  // which is why getDetails used to return an empty season. Passes, in
  // order: old-style /episode/ links, <episodetitle> anchors. If the page
  // has no list at all but the candidate page itself is an episode page
  // (search returns episode pages), synthesize that one episode from the
  // candidate.
  // Episode numbers always come from the text/URL — never from list order
  // (the list is newest-first). The watch servers themselves are NOT in
  // the static HTML (empty <ul id="watch">, no <btn>, servers load via JS),
  // so getEpisodeSources still returns [] for these pages — the bot shows
  // the real episode picker, and picking an episode hits the same
  // no-direct-copy error as EgyBest (search-only provider).
  private extractSeriesEpisodes(html: string, candidate: Candidate): Episode[] {
    const episodes: Episode[] = [];
    const seen = new Set<string>();

    const pushEp = (rawUrl: string, text: string) => {
      let url = rawUrl.trim();
      if (!url) return;
      if (url.startsWith("/")) url = `${this.currentBase}${url}`;
      if (!url.startsWith("http") || !url.includes("wecima")) return;
      if (seen.has(url)) return;
      let decoded = url;
      try {
        decoded = decodeURIComponent(url);
      } catch {}
      const se = parseSeasonEpisode(text);
      const seUrl = parseSeasonEpisode(decoded);
      const episode = se.episode ?? seUrl.episode;
      if (!episode) return;
      seen.add(url);
      episodes.push({
        season: se.season ?? seUrl.season ?? 1,
        episode,
        title: text || `الحلقة ${episode}`,
        url,
      });
    };

    // 1. Old-style /episode/ links.
    for (const m of html.matchAll(/<a\s+href="([^"]*\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      pushEp(m[1], m[2].replace(/<[^>]+>/g, "").trim());
    }
    // 2. Current theme: <episodetitle>الحلقة N</episodetitle> anchors.
    for (const m of html.matchAll(/<a\s+href="([^"]+)"[^>]*>[\s\S]*?<episodetitle>([^<]+)<\/episodetitle>/gi)) {
      pushEp(m[1], m[2].trim());
    }
    // NOTE: no generic whole-page anchor scan here on purpose — the page
    // also lists OTHER shows' episodes ("related" cards), and a generic
    // scan pulls those in as phantom seasons/episodes of this show
    // (verified live: 4 bogus seasons from one page).

    // 4. The candidate page itself is an episode page.
    if (episodes.length === 0) {
      let decoded = candidate.url;
      try {
        decoded = decodeURIComponent(candidate.url);
      } catch {}
      const se = parseSeasonEpisode(candidate.title);
      const seUrl = parseSeasonEpisode(decoded);
      const episode = se.episode ?? seUrl.episode;
      if (episode) {
        episodes.push({
          season: se.season ?? seUrl.season ?? 1,
          episode,
          title: candidate.title,
          url: candidate.url,
        });
      }
    }

    return episodes;
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

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    return {
      quality: "720p HD",
      directVideoUrl: watchUrl,
      fileName: "wecima-video.mp4",
    };
  }
}
