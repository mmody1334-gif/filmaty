// 6-char bot codes: the user sends the code to @filmatibot and gets the
// video directly, instead of tapping a /start deep link (which can hang).
// Codes are stored in KV for 1 hour and are reusable within that hour.

export const BOT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const BOT_CODE_TTL_SECONDS = 3600;

export interface BotCodePayload {
  type: "movie" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
  quality?: string;
}

export function botCodeKey(code: string): string {
  return `botcode:${code}`;
}

// 6 chars from the unambiguous alphabet (no 0/O, 1/l, I).
export function isBotCode(text: string): boolean {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(text);
}

export function generateBotCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) {
    code += BOT_CODE_ALPHABET[b % BOT_CODE_ALPHABET.length];
  }
  return code;
}
