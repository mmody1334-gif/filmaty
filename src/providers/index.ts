import { AkwamProvider } from "./akwam.ts";
import { EgyBestProvider } from "./egybest.ts";
import { UniversalEmbedProvider } from "./embed.ts";
import { FaselHdProvider } from "./faselhd.ts";
import { FushaarProvider } from "./fushaar.ts";
import { LarozaProvider } from "./laroza.ts";
import { MyCimaProvider } from "./mycima.ts";
import { NetflixGlobalProvider } from "./netflix-global.ts";
import { TopCinemaProvider } from "./topcinema.ts";
import { isRelevant } from "../engine/normalize.ts";
import type { Candidate, MediaKind, Provider } from "./types.ts";

export const ALL_PROVIDERS: Provider[] = [
  new AkwamProvider(),
  new NetflixGlobalProvider(),
  new EgyBestProvider(),
  new TopCinemaProvider(),
  new FushaarProvider(),
  new MyCimaProvider(),
  new LarozaProvider(),
  new FaselHdProvider(),
  new UniversalEmbedProvider(),
];

export async function searchAllProviders(
  query: string,
  kind?: MediaKind,
  disabledSites: string[] = [],
  // When true, the same title from different providers is kept as
  // separate candidates (one per site) instead of being merged into the
  // first provider's entry. The resolver needs this: if the first
  // provider's copy is on a dead host, the next provider's copy of the
  // SAME title is the only working download — VisionQuest S1E1: Akwam's
  // file hangs on its s204d1 node, Laroza's validates fine, but the
  // merge dropped Laroza entirely so the resolver never saw it.
  // UI callers keep the default merge (one entry per title).
  keepPerSite = false,
  // When set, search ONLY these provider ids. The direct resolver uses
  // this: a resolve runs up to 4 query rounds, and 9 providers per round
  // (plus details/probes, plus redirect hops) exhausts the Worker's
  // subrequest budget (~50/request) before the working copy is ever
  // tried — حب متنكر died exactly this way (Laroza's details came back
  // empty and round 3 never ran, while the same candidate resolved fine
  // in isolation). Only Akwam, Laroza and the embed scraper (whose
  // vidsrc/streamwish pages sometimes carry a direct mp4) have ever
  // yielded a validated direct mp4; the others return file hosts,
  // stubs, or embeds, which cannot serve the native player or a direct
  // download anyway.
  onlySites?: string[],
): Promise<Candidate[]> {
  const activeProviders = ALL_PROVIDERS.filter(
    (p) => !disabledSites.includes(p.id) && (!onlySites || onlySites.includes(p.id)),
  );

  // Run all active providers in parallel
  const settled = await Promise.allSettled(
    activeProviders.map(async (p) => {
      try {
        return await p.search(query, kind);
      } catch (err) {
        console.error(`Search error on provider ${p.id}:`, err);
        return [];
      }
    }),
  );

  const merged: Candidate[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Map<string, Candidate>();

  for (const res of settled) {
    if (res.status !== "fulfilled") continue;
    for (const cand of res.value) {
      if (seenUrls.has(cand.url)) continue;
      seenUrls.add(cand.url);

      if (!isRelevant(cand.title, query)) continue;

      const normTitle = cand.title.toLowerCase().replace(/[\s\-_:]+/g, "");
      const key = keepPerSite
        ? `${cand.site}:${cand.kind}:${normTitle}:${cand.year || ""}`
        : `${cand.kind}:${normTitle}:${cand.year || ""}`;
      const existing = seenTitles.get(key);
      if (!existing) {
        seenTitles.set(key, cand);
        merged.push(cand);
      } else {
        existing.similarity = Math.min(1.0, (existing.similarity || 0.7) + 0.15);
      }
    }
  }

  // Sort by highest similarity, prioritizing direct MP4 CDN providers (akwam first, then laroza)
  return merged.sort((a, b) => {
    const simDiff = (b.similarity || 0) - (a.similarity || 0);
    if (Math.abs(simDiff) > 0.25) return simDiff;
    if (a.site === "akwam" && b.site !== "akwam") return -1;
    if (b.site === "akwam" && a.site !== "akwam") return 1;
    if (a.site === "laroza" && b.site !== "laroza") return -1;
    if (b.site === "laroza" && a.site !== "laroza") return 1;
    return simDiff;
  });
}

export function findProvider(siteId: string): Provider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === siteId);
}
