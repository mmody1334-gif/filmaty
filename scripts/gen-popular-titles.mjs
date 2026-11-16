// Generates src/data/popular-titles.ts — a baked-in bilingual index of
// famous titles used by the search engine for partial-word matching.
// TMDB's search index matches whole words only, so a compound title like
// "WandaVision" can never come back for q=vision (and TMDB ar returns 0
// hits for "فيجن"); this local index is searched by substring in both
// scripts ("vision" ⊂ "WandaVision", "فيجن" ⊂ "واندافيجن").
//
// Usage: node scripts/gen-popular-titles.mjs
// (plain node, no deps; uses the public TMDB key from wrangler.toml)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMDB_BASE = "https://api.themoviedb.org/3";

// Public key already embedded in the frontend and wrangler.toml [vars].
const FALLBACK_KEY = "15d2ea6d0dc1d476efbca3eba2b9bbfb";
const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf-8");
const TMDB_KEY = toml.match(/TMDB_KEY\s*=\s*"([^"]+)"/)?.[1] || FALLBACK_KEY;

// [endpoint, media_type, pages] — each fetched in en-US and ar.
const LISTS = [
  ["/trending/movie/week", "movie", 2],
  ["/trending/tv/week", "tv", 2],
  ["/movie/popular", "movie", 5],
  ["/tv/popular", "tv", 5],
  ["/movie/top_rated", "movie", 5],
  ["/tv/top_rated", "tv", 5],
];

// Titles that must exist in the index even if they fall out of the lists.
const SEEDS = [
  { id: 85271, media_type: "tv" }, // WandaVision
  { id: 48866, media_type: "tv" }, // The 100
  { id: 157336, media_type: "movie" }, // Interstellar
  { id: 1405, media_type: "tv" }, // Dexter
  { id: 597, media_type: "movie" }, // Titanic
  { id: 19995, media_type: "movie" }, // Avatar
  { id: 76600, media_type: "movie" }, // Avatar: The Way of Water
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const u = new URL(`${TMDB_BASE}${path}`);
  u.searchParams.set("api_key", TMDB_KEY);
  u.searchParams.set("include_adult", "false");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(15000) });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
    return res.json();
  }
  throw new Error(`TMDB rate-limited for ${path}`);
}

const byKey = new Map();

function displayTitle(item) {
  return item.title || item.name || item.original_title || item.original_name || "";
}

function addItem(item, mediaType, lang) {
  if (!item?.id) return;
  const key = `${mediaType}:${item.id}`;
  const existing = byKey.get(key) || {
    id: item.id,
    media_type: mediaType,
    title_en: "",
    title_ar: "",
    popularity: 0,
    vote_average: 0,
    poster_path: null,
    release_date: item.release_date || undefined,
    first_air_date: item.first_air_date || undefined,
  };
  const title = displayTitle(item);
  if (lang === "en-US") existing.title_en = title || existing.title_en;
  else existing.title_ar = title || existing.title_ar;
  existing.popularity = Math.max(existing.popularity, item.popularity || 0);
  existing.vote_average = item.vote_average ?? existing.vote_average;
  existing.poster_path = item.poster_path ?? existing.poster_path;
  if (item.release_date) existing.release_date = item.release_date;
  if (item.first_air_date) existing.first_air_date = item.first_air_date;
  existing._vote_count = Math.max(existing._vote_count || 0, item.vote_count || 0);
  byKey.set(key, existing);
}

async function main() {
  for (const [path, mediaType, pages] of LISTS) {
    for (let page = 1; page <= pages; page++) {
      for (const lang of ["en-US", "ar"]) {
        const data = await tmdb(path, { language: lang, page });
        for (const item of data.results || []) addItem(item, mediaType, lang);
        await sleep(250);
      }
    }
    console.log(`fetched ${path} (${pages} pages x 2 langs), ${byKey.size} unique so far`);
  }

  for (const seed of SEEDS) {
    const key = `${seed.media_type}:${seed.id}`;
    if (byKey.has(key)) continue;
    const base = `/${seed.media_type}/${seed.id}`;
    const [en, ar] = [await tmdb(base, { language: "en-US" }), await tmdb(base, { language: "ar" })];
    // Seed detail responses carry the same fields as list items.
    addItem({ ...en, vote_count: en.vote_count ?? 1000 }, seed.media_type, "en-US");
    addItem({ ...ar, vote_count: ar.vote_count ?? 1000 }, seed.media_type, "ar");
    await sleep(250);
    console.log(`seed added: ${seed.media_type}/${seed.id} (${displayTitle(en)})`);
  }

  const items = [...byKey.values()]
    .filter((it) => (it._vote_count || 0) >= 100)
    .map((it) => ({
      id: it.id,
      media_type: it.media_type,
      title_en: it.title_en,
      title_ar: it.title_ar || it.title_en,
      popularity: it.popularity,
      vote_average: it.vote_average,
      // Accumulated votes, not current popularity: popularity is a weekly
      // spike (a brand-new show, VisionQuest, sits at 308 vs WandaVision's
      // 35), while vote_count is stable fame (498 vs 13,058) — the signal
      // the search ranking uses to put the famous title first.
      vote_count: it._vote_count || 0,
      poster_path: it.poster_path,
      ...(it.release_date ? { release_date: it.release_date } : {}),
      ...(it.first_air_date ? { first_air_date: it.first_air_date } : {}),
    }))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

  const missingSeeds = SEEDS.filter((s) => !items.some((it) => it.id === s.id && it.media_type === s.media_type));
  if (missingSeeds.length > 0) {
    throw new Error(`seeds missing after generation: ${JSON.stringify(missingSeeds)}`);
  }

  const out = `// GENERATED by scripts/gen-popular-titles.mjs — do not edit by hand.
// Regenerate: node scripts/gen-popular-titles.mjs
// Baked-in bilingual index of famous titles (${items.length} entries,
// generated ${new Date().toISOString().slice(0, 10)}). The search engine
// substring-matches queries against title_en/title_ar because TMDB's
// search index matches whole words only ("WandaVision" never comes back
// for q=vision; TMDB ar returns 0 hits for "فيجن").

export interface PopularTitle {
  id: number;
  media_type: "movie" | "tv";
  title_en: string;
  title_ar: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
}

export const POPULAR_TITLES: PopularTitle[] = ${JSON.stringify(items, null, 2)};
`;
  mkdirSync(join(ROOT, "src/data"), { recursive: true });
  writeFileSync(join(ROOT, "src/data/popular-titles.ts"), out);
  console.log(`\nwrote src/data/popular-titles.ts: ${items.length} entries`);
  console.log(`seeds present: ${SEEDS.map((s) => `${s.media_type}:${s.id}`).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
