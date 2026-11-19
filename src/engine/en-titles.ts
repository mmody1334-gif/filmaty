// English titles shown under the Arabic one on cards ("title_en").
// TMDB lists are fetched in Arabic; the English name comes from a
// parallel en-US copy of the same list, or from a details response that
// carries append_to_response=translations.

const titleOf = (x: any): string | undefined => x?.title || x?.name || undefined;

export function attachEnTitles<T extends { id?: number | null; media_type?: string }>(
  items: T[],
  enList: any[],
  fallbackType?: "movie" | "tv",
): T[] {
  const en = new Map<string, string>();
  for (const e of enList || []) {
    const t = titleOf(e);
    const type = e?.media_type || fallbackType;
    if (e?.id && t) en.set(`${type}:${e.id}`, t);
  }
  return items.map((it: any) => {
    if (it.title_en) return it;
    const t = en.get(`${it.media_type || fallbackType}:${it.id}`) || englishOriginal(it);
    return t ? { ...it, title_en: t } : it;
  });
}

// Original title is already English for English-language titles.
export function englishOriginal(it: any): string | undefined {
  if (it?.original_language !== "en") return undefined;
  return it.original_title || it.original_name || undefined;
}

export function enTitleFromTranslations(details: any): string | undefined {
  const list: any[] = details?.translations?.translations || [];
  const pick =
    list.find((t) => t.iso_639_1 === "en" && t.iso_3166_1 === "US") ||
    list.find((t) => t.iso_639_1 === "en");
  return pick?.data?.title || pick?.data?.name || englishOriginal(details);
}
