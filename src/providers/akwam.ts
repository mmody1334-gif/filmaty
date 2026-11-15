import { cleanTitle, computeSimilarity, isRelevant, parseQuality, parseSeasonEpisode, parseYear } from "../engine/normalize.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, Provider, ResolvedStream, SeasonGroup, SourceLink } from "./types.ts";

export const AKWAM_BASE = "https://akwam.ss";

export function akwamHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9",
    Referer: `${AKWAM_BASE}/`,
  };
}

export const FILLER_WORDS = new Set([
  "marvel",
  "مارفل",
  "disney",
  "ديزني",
  "netflix",
  "نتفلكس",
  "نتفليكس",
  "dc",
  "دي سي",
  "فيلم",
  "مسلسل",
  "movie",
  "film",
  "series",
]);

export const POPULAR_ALIASES: Record<string, string> = {
  "ثانوس": "Avengers Endgame",
  "thanos": "Avengers Endgame",
  "اندجيم": "Endgame",
  "اند جيم": "Endgame",
  "مارفل اندجيم": "Avengers Endgame",
  "marvel endgame": "Avengers Endgame",
  "انفنتي وور": "Avengers Infinity War",
  "انفينيتي وور": "Avengers Infinity War",
  "infinity war": "Avengers Infinity War",
  "افنجرز": "Avengers",
  "avengers": "Avengers",
  "سبايدر مان": "Spider-Man",
  "سبايدرمان": "Spider-Man",
  "spiderman": "Spider-Man",
  "باتمان": "Batman",
  "الرجل الوطواط": "Batman",
  "سوبرمان": "Superman",
  "سوبر مان": "Superman",
  "ديدبول": "Deadpool",
  "ولفرين": "Wolverine",
  "جون ويك": "John Wick",
  "فاست اند فيورس": "Fast & Furious",
  "فاست اند فيريوس": "Fast & Furious",
  "هاري بوتر": "Harry Potter",
  "سيد الخواتم": "Lord of the Rings",
  "صراع العروش": "Game of Thrones",
  "قيم اوف ثرونز": "Game of Thrones",
  "بريكنج باد": "Breaking Bad",
  "بيكي بلاندرز": "Peaky Blinders",
  "سترينجر ثينقز": "Stranger Things",
  "فايكنج": "Vikings",
  "فايكنجز": "Vikings",
  "بريزون بريك": "Prison Break",
  "ذا بويز": "The Boys",
};

export function buildSmartQueries(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const qLower = trimmed.toLowerCase();
  const queries: string[] = [trimmed];

  for (const [alias, mapped] of Object.entries(POPULAR_ALIASES)) {
    if (qLower === alias || qLower.includes(alias)) {
      if (!queries.includes(mapped)) queries.push(mapped);
    }
  }

  const tokens = qLower.split(/\s+/).filter((w) => !FILLER_WORDS.has(w));
  if (tokens.length > 0 && tokens.length < qLower.split(/\s+/).length) {
    const stripped = tokens.join(" ");
    if (!queries.includes(stripped)) queries.push(stripped);
  }

  return queries;
}

export function scoreMovieItem(item: Candidate, terms: Set<string>): number {
  const tLower = item.title.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (!term || term.length < 2) continue;
    if (tLower.includes(term)) {
      score += 15;
      const wordRegex = new RegExp(`(^|\\s|[:\\-_])${term}($|\\s|[:\\-_])`, "i");
      if (wordRegex.test(tLower)) {
        score += 20;
      }
    }
  }

  if (terms.has("endgame") && tLower.includes("endgame")) {
    score += 50;
    if (tLower.includes("avengers")) score += 50;
  }

  return score;
}

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

export class AkwamProvider implements Provider {
  id = "akwam";
  label = "أكوام (سيرفرات فائقة السرعة)";
  kinds: MediaKind[] = ["movie", "series"];

  async search(query: string, kind?: MediaKind): Promise<Candidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const queries = buildSmartQueries(trimmed);
    const seenUrls = new Set<string>();
    const allResults: Candidate[] = [];

    // Search across smart queries and multiple pages in parallel to catch all seasons
    const isMultiSeasonQuery =
      kind === "series" ||
      trimmed.includes("مسلسل") ||
      trimmed.includes("اللعبة") ||
      trimmed.length <= 8;
    const pages = isMultiSeasonQuery ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3];

    const fetchTasks: Promise<Candidate[]>[] = [];
    for (const q of queries) {
      for (const p of pages) {
        fetchTasks.push(
          (async () => {
            const searchUrl = `${AKWAM_BASE}/search?q=${encodeURIComponent(q)}&page=${p}`;
            try {
              const res = await fetch(searchUrl, {
                headers: akwamHeaders(),
                signal: AbortSignal.timeout(6000),
              });
              if (!res.ok) return [];
              const html = await res.text();
              return this.parseSearchResults(html, kind, q);
            } catch {
              return [];
            }
          })(),
        );
      }
    }

    const settled = await Promise.allSettled(fetchTasks);
    for (const res of settled) {
      if (res.status === "fulfilled") {
        for (const item of res.value) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            allResults.push(item);
          }
        }
      }
    }

    if (!allResults.length) return [];

    // Collect terms for scoring
    const terms = new Set<string>();
    for (const q of queries) {
      for (const word of q.toLowerCase().split(/[\s:\-_]+/)) {
        if (word.length >= 2 && !FILLER_WORDS.has(word)) {
          terms.add(word);
        }
      }
    }

    allResults.sort((a, b) => scoreMovieItem(b, terms) - scoreMovieItem(a, terms));
    return allResults.slice(0, 16);
  }

  private parseSearchResults(html: string, targetKind?: MediaKind, queryMatch?: string): Candidate[] {
    const results: Candidate[] = [];
    const entryBoxes = html.split('<div class="entry-box').slice(1);

    for (const box of entryBoxes) {
      const linkMatch = box.match(/href="(https:\/\/akwam\.ss\/(movie|series)\/(\d+)\/([^"]*))"/);
      if (!linkMatch) continue;

      const fullUrl = linkMatch[1];
      const kind = linkMatch[2] as MediaKind;
      const rawId = linkMatch[3];

      if (targetKind && targetKind !== kind) continue;

      const titleMatch =
        box.match(/<h3[^>]*class="entry-title[^"]*"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i) ||
        box.match(/<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i) ||
        box.match(/alt="([^"]+)"/i);
      const rawTitle = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : "";
      if (!rawTitle) continue;

      // Strict relevance check: do not return unrelated trending items
      if (queryMatch) {
        const cleaned = cleanTitle(rawTitle);
        if (!isRelevant(cleaned, queryMatch) && !isRelevant(rawTitle, queryMatch)) {
          continue;
        }
      }

      const posterMatch =
        box.match(/data-src="(https:\/\/img\.downet\.net\/[^"]+)"/i) ||
        box.match(/src="(https:\/\/img\.downet\.net\/[^"]+)"/i);
      const poster = posterMatch ? posterMatch[1] : undefined;

      const ratingMatch = box.match(/<span class="label rating"[^>]*>[\s\S]*?([0-9.]+)\s*<\/span>/i);
      const rating = ratingMatch ? ratingMatch[1].trim() : undefined;

      const yearMatch = box.match(/<span class="badge badge-pill badge-secondary[^"]*"[^>]*>\s*(\d{4})\s*<\/span>/i);
      const year = yearMatch ? Number(yearMatch[1].trim()) : parseYear(rawTitle);

      let displayTitle = cleanTitle(rawTitle);
      if (kind === "series") {
        const decodedUrl = decodeURIComponent(fullUrl);
        const se = parseSeasonEpisode(rawTitle + " " + decodedUrl);
        if (se.season && !displayTitle.includes(String(se.season))) {
          displayTitle = `${displayTitle} (الموسم ${se.season})`;
        } else if (!se.season) {
          const sMatch = decodedUrl.match(/الموسم-([^\/]+)/);
          if (sMatch) {
            displayTitle = `${displayTitle} (الموسم ${sMatch[1]})`;
          } else if (
            !displayTitle.includes("موسم") &&
            !displayTitle.includes("جزء") &&
            !displayTitle.includes("ج5") &&
            !displayTitle.includes("ج4") &&
            !displayTitle.includes("ج3") &&
            !displayTitle.includes("ج2")
          ) {
            displayTitle = `${displayTitle} (الموسم 1)`;
          }
        }
      }

      results.push({
        id: `akwam:${kind}:${rawId}`,
        title: displayTitle,
        url: fullUrl,
        kind,
        poster,
        year,
        rating,
        site: this.id,
        siteLabel: this.label,
        similarity: 0.9,
      });

      if (results.length >= 16) break;
    }

    return results;
  }

  async getDetails(candidate: Candidate): Promise<MediaDetails> {
    try {
      const res = await fetch(candidate.url, {
        headers: akwamHeaders(),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      return this.parseDetails(html, candidate);
    } catch (err: any) {
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

  private parseDetails(html: string, candidate: Candidate): MediaDetails {
    const isSeries = candidate.url.includes("/series/") || html.includes("/episode/");
    const kind: MediaKind = isSeries ? "series" : "movie";

    const titleMatch =
      html.match(/<h1[^>]*class="entry-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch
      ? decodeHtmlEntities(titleMatch[1]).replace(/\s*\|\s*اكوام.*$/i, "").trim()
      : candidate.title;

    const posterMatch =
      html.match(/<picture>[\s\S]*?<img[^>]+(?:src|data-src)="(https:\/\/img\.downet\.net\/[^"]+)"/i) ||
      html.match(/<img[^>]+(?:src|data-src)="(https:\/\/img\.downet\.net\/[^"]+)"/i);
    const poster = posterMatch ? posterMatch[1] : candidate.poster;

    const yearMatch = html.match(/السنة\s*:\s*(\d{4})/i) || html.match(/>(\d{4})<\/span>/i);
    const year = yearMatch ? Number(yearMatch[1].trim()) : candidate.year;

    const ratingMatch = html.match(/10\s*\/\s*([0-9.]+)/i) || html.match(/rating"[^>]*>[\s\S]*?([0-9.]+)/i);
    const rating = ratingMatch ? ratingMatch[1].trim() : candidate.rating;

    let story: string | undefined;
    const storyWidgetMatch = html.match(/قصة[\s\S]*?<\/h2>[\s\S]*?<div class="widget-body[^"]*">([\s\S]*?)<\/div>/i);
    if (storyWidgetMatch) {
      story = storyWidgetMatch[1].replace(/<[^>]+>/g, "").trim();
    } else {
      const generalStoryMatch = html.match(/<p class="text-white[^"]*">([\s\S]*?)<\/p>/i);
      if (generalStoryMatch) {
        story = generalStoryMatch[1].replace(/<[^>]+>/g, "").trim();
      }
    }

    const sources: SourceLink[] = [];
    const watchLinkRegex = /href="(https:\/\/akwam\.ss\/watch\/(\d+)\/(\d+)\/([^"]*))"/g;
    let wMatch: RegExpExecArray | null;
    const seenStreams = new Set<string>();

    while ((wMatch = watchLinkRegex.exec(html)) !== null) {
      const watchUrl = wMatch[1];
      const streamId = wMatch[2];
      const itemId = wMatch[3];
      const slug = wMatch[4];
      if (seenStreams.has(streamId)) continue;
      seenStreams.add(streamId);

      const downloadUrl = `https://akwam.ss/download/${streamId}/${itemId}/${slug}`;

      let quality = "720p HD";
      let size: string | undefined;

      const dlButtonRegex = new RegExp(
        `href="https:\\/\\/akwam\\.ss\\/download\\/${streamId}\\/${itemId}\\/[^"]*"[^>]*>([\\s\\S]*?)<\\/a>`,
        "i",
      );
      const dlMatch = html.match(dlButtonRegex);
      if (dlMatch) {
        const btnText = dlMatch[1].replace(/<[^>]+>/g, "").trim();
        const sizeMatch = btnText.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|جيجا|ميجابايت))/i);
        if (sizeMatch) size = sizeMatch[1];
      }

      const beforeSnippet = html.slice(Math.max(0, wMatch.index - 200), wMatch.index);
      const afterSnippet = html.slice(wMatch.index, Math.min(html.length, wMatch.index + 200));
      const qBeforeMatches = [...beforeSnippet.matchAll(/(1080p|720p|480p|360p|FHD|HD|SD|4K|2160p)/gi)];
      const qBefore = qBeforeMatches.length ? qBeforeMatches[qBeforeMatches.length - 1][1] : undefined;
      const qAfter = afterSnippet.match(/(1080p|720p|480p|360p|FHD|HD|SD|4K|2160p)/i)?.[1];
      const chosenQ = qBefore || qAfter;

      if (chosenQ) {
        quality = chosenQ.toUpperCase();
        if (quality === "1080P") quality = "1080p FHD";
        else if (quality === "720P") quality = "720p HD";
        else if (quality === "480P") quality = "480p SD";
      } else if (sources.length === 0) {
        quality = "1080p FHD";
      } else if (sources.length === 1) {
        quality = "720p HD";
      } else {
        quality = "480p SD";
      }

      sources.push({
        name: `أكوام ${quality}${size ? ` (${size})` : ""}`,
        url: watchUrl,
        quality,
        kind: "mp4",
        fileSize: size,
        downloadUrl,
        streamId,
        referer: candidate.url,
      });
    }

    const seasons: SeasonGroup[] = [];
    if (isSeries) {
      const epRegex = /href="(https:\/\/akwam\.ss\/episode\/(\d+)\/[^"]*\/[^\d"]*(\d+))"/g;
      let epMatch: RegExpExecArray | null;
      const seenEpisodes = new Set<string>();
      const episodes: Episode[] = [];

      while ((epMatch = epRegex.exec(html)) !== null) {
        const epUrl = epMatch[1];
        const epId = epMatch[2];
        const epNumber = Number(epMatch[3]) || 1;
        if (seenEpisodes.has(epId)) continue;
        seenEpisodes.add(epId);

        episodes.push({
          id: epId,
          season: 1,
          episode: epNumber,
          title: `الحلقة ${epNumber}`,
          url: epUrl,
        });
      }

      episodes.sort((a, b) => a.episode - b.episode);
      if (episodes.length > 0) {
        seasons.push({ season: 1, episodes });
      }
    }

    return {
      candidate: { ...candidate, title, poster, year, rating, kind },
      title,
      description: story,
      poster,
      year,
      rating,
      kind,
      seasons,
      sources,
    };
  }

  async getEpisodeSources(episode: Episode): Promise<SourceLink[]> {
    try {
      const res = await fetch(episode.url, {
        headers: akwamHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const html = await res.text();

      const details = this.parseDetails(html, {
        id: `akwam:ep:${episode.id || episode.episode}`,
        title: episode.title,
        kind: "series",
        site: this.id,
        siteLabel: this.label,
        url: episode.url,
      });

      return details.sources;
    } catch {
      return [];
    }
  }

  async resolveStream(watchUrl: string): Promise<ResolvedStream> {
    let html: string;
    try {
      const res = await fetch(watchUrl, {
        headers: akwamHeaders(),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (error: any) {
      throw new Error(`تعذر فتح صفحة البث في أكوام (${error.message})`);
    }

    const sourceMatches = [
      ...html.matchAll(/<source[^>]+src="([^"]+)"/gi),
      ...html.matchAll(/<video[^>]+src="([^"]+)"/gi),
      ...html.matchAll(/(https:\/\/[a-z0-9.]*downet\.net\/download\/[^\s"'<>#]+)/gi),
    ];

    let directVideoUrl: string | undefined;
    for (const m of sourceMatches) {
      if (m && m[1]) {
        const clean = m[1].replace(/#Intent;.*$/i, "").trim();
        if (clean.includes("downet.net") || clean.match(/\.(mp4|mkv|webm|mov|avi)($|\?)/i)) {
          directVideoUrl = clean;
          break;
        }
      }
    }

    if (!directVideoUrl) {
      const downloadUrl = watchUrl.replace("/watch/", "/download/");
      try {
        const dlRes = await fetch(downloadUrl, {
          headers: akwamHeaders(),
          signal: AbortSignal.timeout(10000),
        });
        if (dlRes.ok) {
          const dlHtml = await dlRes.text();
          const dlMatches = [
            ...dlHtml.matchAll(/href="(https:\/\/[a-z0-9.]*downet\.net\/download\/[^\s"'<>#]+)"/gi),
            ...dlHtml.matchAll(/(https:\/\/[a-z0-9.]*downet\.net\/download\/[^\s"'<>#]+)/gi),
          ];
          for (const dm of dlMatches) {
            if (dm && dm[1]) {
              directVideoUrl = dm[1].replace(/#Intent;.*$/i, "").trim();
              break;
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!directVideoUrl) {
      throw new Error("تعذر استخراج رابط الفيديو المباشر (.mp4) لهذا الخيار.");
    }

    let fileName = "";
    try {
      fileName = decodeURIComponent(new URL(directVideoUrl).pathname.split("/").pop() || "");
    } catch {}

    const qualityMatch = fileName.match(/(1080p|720p|480p|360p|4K)/i);
    const quality = qualityMatch ? qualityMatch[1].toUpperCase() : "HD";

    return {
      quality,
      directVideoUrl,
      fileName,
    };
  }
}
