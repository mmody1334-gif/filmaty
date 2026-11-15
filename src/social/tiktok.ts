export interface TikTokResult {
  title: string;
  author?: string;
  thumbnail?: string;
  duration?: number;
  hdVideoUrl?: string;
  sdVideoUrl?: string;
  audioUrl?: string;
  images?: string[];
  size?: number;
  hdSize?: number;
}

function absolute(val?: string | null): string | undefined {
  if (!val || typeof val !== "string") return undefined;
  if (val.startsWith("http")) return val;
  return `https://www.tikwm.com${val.startsWith("/") ? "" : "/"}${val}`;
}

export async function extractTikTok(url: string): Promise<TikTokResult> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`TikWM API responded with HTTP ${res.status}`);
  }

  const json: any = await res.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "Could not parse TikTok link");
  }

  const data = json.data;
  const hdVideoUrl = absolute(data.hdplay);
  const sdVideoUrl = absolute(data.play);
  const audioUrl = absolute(data.music_info?.play) || absolute(data.music);
  const thumbnail = absolute(data.origin_cover) || absolute(data.cover);

  const images: string[] = [];
  if (Array.isArray(data.images)) {
    for (const img of data.images) {
      const u = absolute(typeof img === "string" ? img : img?.url);
      if (u) images.push(u);
    }
  }

  return {
    title: data.title || data.music_info?.title || "TikTok video",
    author: data.author?.nickname || data.author?.unique_id,
    thumbnail,
    duration: Number(data.duration) || undefined,
    hdVideoUrl,
    sdVideoUrl,
    audioUrl,
    images: images.length > 0 ? images : undefined,
    size: Number(data.size) || undefined,
    hdSize: Number(data.hd_size) || undefined,
  };
}
