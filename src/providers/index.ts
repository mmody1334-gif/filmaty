import { AkwamProvider } from "./akwam.ts";
import { UniversalEmbedProvider } from "./embed.ts";
import { FaselHdProvider } from "./faselhd.ts";
import { LarozaProvider } from "./laroza.ts";
import { MyCimaProvider } from "./mycima.ts";
import type { Candidate, MediaKind, Provider } from "./types.ts";

export const ALL_PROVIDERS: Provider[] = [
  new AkwamProvider(),
  new LarozaProvider(),
  new FaselHdProvider(),
  new MyCimaProvider(),
  new UniversalEmbedProvider(),
];

export async function searchAllProviders(
  query: string,
  kind?: MediaKind,
  disabledSites: string[] = [],
): Promise<Candidate[]> {
  // 1. Search Akwam first (fast, reliable, and has direct downet.net CDN)
  if (!disabledSites.includes("akwam")) {
    try {
      const akwam = new AkwamProvider();
      const akwamResults = await akwam.search(query, kind);
      if (akwamResults.length > 0) {
        return akwamResults;
      }
    } catch (err) {
      console.error("Akwam search error in searchAllProviders:", err);
    }
  }

  // 2. Fallback to other providers if Akwam yields no results
  const otherProviders = ALL_PROVIDERS.filter((p) => p.id !== "akwam" && !disabledSites.includes(p.id));
  const results = await Promise.allSettled(
    otherProviders.map((provider) => provider.search(query, kind)),
  );

  const merged: Candidate[] = [];
  const seenTitles = new Map<string, Candidate>();

  for (const res of results) {
    if (res.status !== "fulfilled") continue;
    for (const cand of res.value) {
      const key = `${cand.kind}:${cand.title.toLowerCase().replace(/\s+/g, "")}:${cand.year || ""}`;
      const existing = seenTitles.get(key);
      if (!existing) {
        seenTitles.set(key, cand);
        merged.push(cand);
      } else {
        existing.similarity = Math.min(1.0, (existing.similarity || 0.7) + 0.15);
      }
    }
  }

  return merged.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
}

export function findProvider(siteId: string): Provider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === siteId);
}
