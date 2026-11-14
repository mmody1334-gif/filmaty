export interface Env {
  CACHE: KVNamespace;
  DB: D1Database;
  BOT_TOKEN: string;
  SIGNING_SECRET: string;
  OWNER_IDS?: string;
  WEBHOOK_SECRET?: string;
  PUBLIC_BASE?: string;
  PROVIDERS_DISABLED?: string;
}

export function parseOwnerIds(raw?: string): Set<number> {
  if (!raw) return new Set();
  const set = new Set<number>();
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isNaN(n) && n > 0) set.add(n);
  }
  return set;
}

export function parseList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
