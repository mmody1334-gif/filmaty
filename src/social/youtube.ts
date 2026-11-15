export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  author: string;
  duration?: number;
  thumbnail?: string;
}

export interface YouTubePlaylistItem {
  videoId: string;
  title: string;
  author?: string;
  thumbnail?: string;
  duration?: number;
  index: number;
}

export interface YouTubePlaylistResult {
  playlistId: string;
  title: string;
  author: string;
  videoCount: number;
  items: YouTubePlaylistItem[];
}

export interface YouTubeStreamResult {
  title: string;
  author: string;
  thumbnail?: string;
  streamUrl: string;
  quality: string;
  mimeType: string;
  isAudio: boolean;
  size?: number;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function fetchYouTubeVideoDetails(videoId: string): Promise<YouTubeVideoDetails> {
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "x-youtube-client-name": "28",
        "x-youtube-client-version": "1.65.10",
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID_VR",
            clientVersion: "1.65.10",
            hl: "en",
            gl: "US",
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const data: any = await res.json();
      const details = data?.videoDetails;
      if (details?.title) {
        const thumbs = details.thumbnail?.thumbnails ?? [];
        const bestThumb = thumbs.length ? thumbs[thumbs.length - 1].url : undefined;
        return {
          videoId,
          title: details.title,
          author: details.author || "YouTube",
          duration: details.lengthSeconds ? parseInt(details.lengthSeconds, 10) : undefined,
          thumbnail: bestThumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
      }
    }
  } catch {}

  // Fallback to oEmbed
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (oembedRes.ok) {
      const data: any = await oembedRes.json();
      return {
        videoId,
        title: data.title || `Video ${videoId}`,
        author: data.author_name || "YouTube",
        thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    }
  } catch {}

  return {
    videoId,
    title: `YouTube Video (${videoId})`,
    author: "YouTube",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

export async function fetchYouTubePlaylist(playlistId: string): Promise<YouTubePlaylistResult> {
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      cookie: "CONSENT=YES+cb",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`تعذر فتح قائمة التشغيل (HTTP ${res.status})`);
  }

  const html = await res.text();
  const idx = html.indexOf("var ytInitialData = ");
  if (idx === -1) {
    throw new Error("تعذر قراءة بيانات قائمة التشغيل");
  }

  const endIdx = html.indexOf(";</script>", idx);
  const jsonStr =
    endIdx !== -1
      ? html.substring(idx + "var ytInitialData = ".length, endIdx)
      : html.substring(idx + "var ytInitialData = ".length);

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    throw new Error("فشل فك تشفير بيانات قائمة التشغيل");
  }

  const meta = data.metadata?.playlistMetadataRenderer;
  const title = meta?.title || "YouTube Playlist";

  let author = "YouTube";
  if (data.sidebar?.playlistSidebarRenderer?.items) {
    for (const it of data.sidebar.playlistSidebarRenderer.items) {
      const ownerRuns = it.playlistSidebarSecondaryInfoRenderer?.videoOwner?.videoOwnerRenderer?.title?.runs;
      if (ownerRuns?.[0]?.text) {
        author = ownerRuns[0].text;
        break;
      }
    }
  }

  const items: YouTubePlaylistItem[] = [];
  const seen = new Set<string>();

  function walk(node: any) {
    if (!node || typeof node !== "object") return;

    if (node.lockupViewModel && node.lockupViewModel.contentId) {
      const l = node.lockupViewModel;
      const vid = l.contentId;
      if (vid && !seen.has(vid)) {
        seen.add(vid);
        const vTitle = l.metadata?.lockupMetadataViewModel?.title?.content || `Video ${vid}`;
        const vAuthor =
          l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]
            ?.text?.content;
        const thumb = l.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
        items.push({
          videoId: vid,
          title: vTitle,
          author: vAuthor || author,
          thumbnail: thumb,
          index: items.length + 1,
        });
      }
      return;
    }

    if (node.playlistVideoRenderer && node.playlistVideoRenderer.videoId) {
      const r = node.playlistVideoRenderer;
      const vid = r.videoId;
      if (vid && !seen.has(vid)) {
        seen.add(vid);
        const vTitle = r.title?.runs?.[0]?.text || r.title?.simpleText || `Video ${vid}`;
        const vAuthor = r.shortBylineText?.runs?.[0]?.text;
        const thumb = r.thumbnail?.thumbnails?.[0]?.url;
        const dur = r.lengthSeconds ? parseInt(r.lengthSeconds, 10) : undefined;
        items.push({
          videoId: vid,
          title: vTitle,
          author: vAuthor || author,
          thumbnail: thumb,
          duration: dur,
          index: items.length + 1,
        });
      }
      return;
    }

    for (const key of Object.keys(node)) {
      walk(node[key]);
    }
  }

  if (data.contents) {
    walk(data.contents);
  }

  return {
    playlistId,
    title,
    author,
    videoCount: items.length,
    items,
  };
}

export async function extractYouTubeStream(
  videoId: string,
  mode: "video" | "audio" = "video",
  targetQuality = "720",
): Promise<YouTubeStreamResult> {
  const details = await fetchYouTubeVideoDetails(videoId);

  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "x-youtube-client-name": "28",
      "x-youtube-client-version": "1.65.10",
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "ANDROID_VR",
          clientVersion: "1.65.10",
          hl: "en",
          gl: "US",
        },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`YouTube API returned HTTP ${res.status}`);
  }

  const data: any = await res.json();
  const formats: any[] = data.streamingData?.formats ?? [];
  const adaptive: any[] = data.streamingData?.adaptiveFormats ?? [];

  if (mode === "audio") {
    const audioFormats = adaptive.filter((f) => f.url && (f.mimeType?.startsWith("audio/") || f.audioQuality));
    audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    const chosen = audioFormats[0];
    if (!chosen) {
      throw new Error("تعذر العثور على مسار صوتي مباشر لهذا الفيديو.");
    }

    return {
      title: details.title,
      author: details.author,
      thumbnail: details.thumbnail,
      streamUrl: chosen.url,
      quality: `${Math.round((chosen.bitrate || 128000) / 1000)}k`,
      mimeType: chosen.mimeType || "audio/mp4",
      isAudio: true,
      size: chosen.contentLength ? parseInt(chosen.contentLength, 10) : undefined,
    };
  }

  // Video mode: formats with both audio and video
  const combined = formats.filter((f) => f.url && f.mimeType?.startsWith("video/"));
  const videoAdaptive = adaptive.filter((f) => f.url && f.mimeType?.startsWith("video/"));

  let targetFormat = combined.find((f) => f.qualityLabel?.startsWith(targetQuality)) ||
    videoAdaptive.find((f) => f.qualityLabel?.startsWith(targetQuality));

  if (!targetFormat) {
    targetFormat = combined[0] || videoAdaptive[0];
  }

  if (!targetFormat || !targetFormat.url) {
    throw new Error("تعذر استخراج رابط فيديو مباشر من يوتيوب.");
  }

  return {
    title: details.title,
    author: details.author,
    thumbnail: details.thumbnail,
    streamUrl: targetFormat.url,
    quality: targetFormat.qualityLabel || `${targetQuality}p`,
    mimeType: targetFormat.mimeType || "video/mp4",
    isAudio: false,
    size: targetFormat.contentLength ? parseInt(targetFormat.contentLength, 10) : undefined,
  };
}
