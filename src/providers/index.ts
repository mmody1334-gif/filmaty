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
): Promise<Candidate[]> {
  const activeProviders = ALL_PROVIDERS.filter((p) => !disabledSites.includes(p.id));

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

      const key = `${cand.kind}:${cand.title.toLowerCase().replace(/[\s\-_:]+/g, "")}:${cand.year || ""}`;
      const existing = seenTitles.get(key);
      if (!existing) {
        seenTitles.set(key, cand);
        merged.push(cand);
      } else {
        existing.similarity = Math.min(1.0, (existing.similarity || 0.7) + 0.15);
      }
    }
  }

  // Sort by highest similarity, prioritizing Akwam direct CDN if similarity is close
  return merged.sort((a, b) => {
    const simDiff = (b.similarity || 0) - (a.similarity || 0);
    if (Math.abs(simDiff) > 0.15) return simDiff;
    if (a.site === "akwam" && b.site !== "akwam") return -1;
    if (b.site === "akwam" && a.site !== "akwam") return 1;
    return simDiff;
  });
}

export function findProvider(siteId: string): Provider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === siteId);
}
