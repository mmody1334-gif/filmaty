export type SocialPlatform = "tiktok" | "instagram" | "youtube" | "unknown";

export function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return undefined;
  return match[0].replace(/[.,;:!?)\]}]+$/, "");
}

export function detectSocialPlatform(url: string): SocialPlatform {
  try {
    const parsed = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`);
    const host = parsed.hostname.toLowerCase();
    if (/(^|\.)tiktok\.com$/i.test(host)) return "tiktok";
    if (/(^|\.)(instagram\.com|instagr\.am)$/i.test(host)) return "instagram";
    if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) return "youtube";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function parseYouTubeVideo(raw: string): { videoId: string } | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    const host = parsed.hostname.toLowerCase();
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) return null;

    if (/(^|\.)youtu\.be$/i.test(host)) {
      const id = parsed.pathname.slice(1).split("/")[0];
      if (id && /^[\w-]{11}$/.test(id)) return { videoId: id };
    }

    const vParam = parsed.searchParams.get("v");
    if (vParam && /^[\w-]{11}$/.test(vParam)) return { videoId: vParam };

    const match = parsed.pathname.match(/\/(shorts|embed|v|live)\/([\w-]{11})/i);
    if (match) return { videoId: match[2] };

    return null;
  } catch {
    return null;
  }
}

export function parseYouTubePlaylist(raw: string): { playlistId: string } | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    const host = parsed.hostname.toLowerCase();
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(host)) return null;

    const list = parsed.searchParams.get("list");
    if (list && /^[\w-]{10,}$/.test(list) && list !== "WL") {
      return { playlistId: list };
    }

    return null;
  } catch {
    return null;
  }
}
