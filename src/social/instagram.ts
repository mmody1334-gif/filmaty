export interface InstagramResult {
  title: string;
  author?: string;
  thumbnail?: string;
  videoUrl?: string;
  images?: string[];
  duration?: number;
}

const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function shortcodeToMediaId(shortcode: string): string {
  let value = 0n;
  for (const char of shortcode) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index < 0) return "";
    value = value * 64n + BigInt(index);
  }
  return value.toString();
}

export function parseInstagramShortcode(url: string): { shortcode: string; kind: string } | null {
  const match = url.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() === "reels" ? "reel" : match[1].toLowerCase(),
    shortcode: match[2],
  };
}

export async function extractInstagram(url: string, igCookie?: string): Promise<InstagramResult> {
  const target = parseInstagramShortcode(url);
  if (!target) {
    throw new Error("رابط إنستغرام غير صالح. تأكد من إرسال رابط منشور أو ريلز.");
  }

  const mediaId = shortcodeToMediaId(target.shortcode);
  const headers: Record<string, string> = {
    "x-ig-app-id": "936619743392459",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 299.0.0.17.109",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (igCookie) headers.Cookie = igCookie;

  // 1. Try Mobile App API
  if (mediaId) {
    for (const host of ["https://i.instagram.com", "https://www.instagram.com"]) {
      try {
        const res = await fetch(`${host}/api/v1/media/${mediaId}/info/`, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const payload: any = await res.json();
          const item = payload?.items?.[0];
          if (item) {
            const videoUrl = item.video_versions?.[0]?.url;
            const images: string[] = [];

            if (Array.isArray(item.carousel_media)) {
              for (const node of item.carousel_media) {
                const v = node.video_versions?.[0]?.url;
                if (v && !videoUrl) {
                  // carousel video
                }
                const img = node.image_versions2?.candidates?.[0]?.url;
                if (img) images.push(img);
              }
            } else if (item.image_versions2?.candidates?.[0]?.url) {
              images.push(item.image_versions2.candidates[0].url);
            }

            return {
              title: item.caption?.text?.slice(0, 200) || `Instagram ${item.media_type === 2 ? "reel" : "post"}`,
              author: item.user?.username,
              thumbnail: item.image_versions2?.candidates?.[0]?.url,
              videoUrl,
              images: images.length > 0 ? images : undefined,
              duration: item.video_duration ? Number(item.video_duration) : undefined,
            };
          }
        }
      } catch {}
    }
  }

  // 2. Fallback to public embed page
  try {
    const embedUrl = `https://www.instagram.com/${target.kind}/${target.shortcode}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const html = await res.text();
      const videoMatch = html.match(/"video_url":"(https:[^"]+?)"/);
      const displayMatch = html.match(/"display_url":"(https:[^"]+?)"/);
      const authorMatch = html.match(/"username":"([^"]+)"/);
      const captionMatch = html.match(/"caption":"([^"]{1,200})"/);

      const videoUrl = videoMatch ? videoMatch[1].replace(/\\u0026/g, "&") : undefined;
      const imageUrl = displayMatch ? displayMatch[1].replace(/\\u0026/g, "&") : undefined;

      if (videoUrl || imageUrl) {
        return {
          title: captionMatch ? captionMatch[1] : `Instagram ${target.kind}`,
          author: authorMatch ? authorMatch[1] : undefined,
          videoUrl,
          images: imageUrl ? [imageUrl] : undefined,
          thumbnail: imageUrl,
        };
      }
    }
  } catch {}

  throw new Error("تعذر استخراج محتوى إنستغرام. تأكد من أن الحساب أو المنشور عام (Public).");
}
