// The name a downloaded file is saved as. Used server-side (the
// resolve token's `n` becomes the Content-Disposition filename in the
// /stream proxy) and client-side (the anchor's `download` attribute,
// which only applies same-origin).
//
// Movies: "Interstellar". Series episodes: "VisionQuest S01E01" — the
// season/episode suffix is what stops a whole season collapsing into
// one file name (every episode used to download as "VisionQuest.mp4",
// so Chrome asked "Download file again?" and nobody could tell which
// episode was downloading).
export function downloadDisplayName(title: string, season?: number, episode?: number): string {
  const base = (title || "filmaty").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "filmaty";
  if (season !== undefined && episode !== undefined) {
    return `${base} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  }
  return base;
}
