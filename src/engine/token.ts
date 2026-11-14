export interface MediaPayload {
  u: string; // Target media URL
  r?: string; // Optional Referer
  n: string; // Title
  k: "mp4" | "hls" | "embed"; // Media stream kind
  e: number; // Expiry unix timestamp
  d?: number; // Direct flag
}

export async function signToken(payload: MediaPayload, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const jsonStr = JSON.stringify(payload);
  const dataB64 = base64UrlEncode(enc.encode(jsonStr));

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(dataB64));
  const sigB64 = base64UrlEncode(new Uint8Array(sig));

  return `${dataB64}.${sigB64}`;
}

export async function verifyToken(token: string, secret: string): Promise<MediaPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [dataB64, sigB64] = parts;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(sigB64),
      enc.encode(dataB64),
    );

    if (!valid) return null;

    const dec = new TextDecoder();
    const payload = JSON.parse(dec.decode(base64UrlDecode(dataB64))) as MediaPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.e && payload.e < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
