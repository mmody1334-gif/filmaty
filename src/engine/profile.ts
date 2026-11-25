import type { Env } from "../env.ts";

export type ProfileMediaType = "movie" | "tv";

export interface ProfileProgressEntry {
  type: ProfileMediaType;
  id: number;
  s: number;
  e: number;
  t: number;
  d: number;
  updated: number;
  title: string;
  poster: string;
  kind: string;
}

export interface ProfileMyListEntry {
  type: ProfileMediaType;
  id: number;
  title: string;
  poster: string;
  kind: string;
  added: number;
}

export interface ProfileHistoryEntry {
  type: ProfileMediaType;
  id: number;
  s: number;
  e: number;
  title: string;
  poster: string;
  kind: string;
  at: number;
  genreIds?: number[];
  runtime?: number;
}

export interface UserProfileData {
  username: string;
  updatedAt: number;
  avatar?: string;
  progress: Record<string, ProfileProgressEntry>;
  watched: Record<string, number>;
  myList: Record<string, ProfileMyListEntry>;
  removedMyList: Record<string, number>;
  history: ProfileHistoryEntry[];
}

export interface ProfilePatch extends Partial<UserProfileData> {
  clearProgressKeys?: unknown;
}

const PROFILE_CACHE_PREFIX = "profile:v1:";
const PROFILE_TTL_SECONDS = 365 * 24 * 3600;
const MAX_PROGRESS = 25;
const MAX_WATCHED = 200;
const MAX_MYLIST = 60;
const MAX_REMOVED_MYLIST = 100;
const MAX_HISTORY = 40;

const initializedDbs = new WeakSet<object>();

/** Normalize and validate a public profile username (e.g. "megoo"). */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z0-9_.\-\u0600-\u06ff]{2,32}$/.test(cleaned)) return null;
  return cleaned;
}

export function profileCacheKey(username: string): string {
  return `${PROFILE_CACHE_PREFIX}${username}`;
}

export function emptyProfile(username: string): UserProfileData {
  return {
    username,
    updatedAt: 0,
    progress: {},
    watched: {},
    myList: {},
    removedMyList: {},
    history: [],
  };
}

function clipStr(val: unknown, maxLen = 240): string {
  return typeof val === "string" ? val.slice(0, maxLen) : "";
}

function isMediaType(val: unknown): val is ProfileMediaType {
  return val === "movie" || val === "tv";
}

function posInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegInt(val: unknown): number {
  const n = Math.floor(Number(val));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function sanitizeProgressMap(raw: unknown): Record<string, ProfileProgressEntry> {
  const out: Record<string, ProfileProgressEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const val of Object.values(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const rec = val as Record<string, unknown>;
    if (!isMediaType(rec.type)) continue;
    const id = posInt(rec.id);
    if (!id) continue;
    const s = rec.type === "tv" ? nonNegInt(rec.s) : 0;
    const e = rec.type === "tv" ? nonNegInt(rec.e) : 0;
    const t = Math.floor(Number(rec.t));
    if (!Number.isFinite(t) || t < 2) continue;
    const d = Math.floor(Number(rec.d));
    const updated = Number(rec.updated);
    const key = `${rec.type}:${id}:${s}:${e}`;
    out[key] = {
      type: rec.type,
      id,
      s,
      e,
      t,
      d: Number.isFinite(d) && d > 0 ? d : 0,
      updated: Number.isFinite(updated) && updated > 0 ? updated : Date.now(),
      title: clipStr(rec.title),
      poster: clipStr(rec.poster, 400),
      kind: clipStr(rec.kind, 32) || rec.type,
    };
  }
  return out;
}

function sanitizeWatchedMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(movie|tv):(\d+):(\d+):(\d+)$/.test(k)) continue;
    const ts = Number(v);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    out[k] = ts;
  }
  return out;
}

function sanitizeMyListMap(raw: unknown): Record<string, ProfileMyListEntry> {
  const out: Record<string, ProfileMyListEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const val of Object.values(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const rec = val as Record<string, unknown>;
    if (!isMediaType(rec.type)) continue;
    const id = posInt(rec.id);
    if (!id) continue;
    const added = Number(rec.added);
    const key = `${rec.type}:${id}`;
    out[key] = {
      type: rec.type,
      id,
      title: clipStr(rec.title),
      poster: clipStr(rec.poster, 400),
      kind: clipStr(rec.kind, 32) || rec.type,
      added: Number.isFinite(added) && added > 0 ? added : Date.now(),
    };
  }
  return out;
}

function sanitizeRemovedMyListMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(movie|tv):(\d+)$/.test(k)) continue;
    const ts = Number(v);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    out[k] = ts;
  }
  return out;
}

function sanitizeAvatar(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/[<>"'`]/g, "").trim().slice(0, 16);
  return cleaned || undefined;
}

function sanitizeHistoryList(raw: unknown): ProfileHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileHistoryEntry[] = [];
  for (const val of raw) {
    if (!val || typeof val !== "object") continue;
    const rec = val as Record<string, unknown>;
    if (!isMediaType(rec.type)) continue;
    const id = posInt(rec.id);
    if (!id) continue;
    const s = rec.type === "tv" ? nonNegInt(rec.s) : 0;
    const e = rec.type === "tv" ? nonNegInt(rec.e) : 0;
    const at = Number(rec.at);
    const entry: ProfileHistoryEntry = {
      type: rec.type,
      id,
      s,
      e,
      title: clipStr(rec.title),
      poster: clipStr(rec.poster, 400),
      kind: clipStr(rec.kind, 32) || rec.type,
      at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    };
    if (Array.isArray(rec.genreIds)) {
      const genres = rec.genreIds
        .map((g) => posInt(g))
        .filter((g): g is number => Boolean(g))
        .slice(0, 8);
      if (genres.length) entry.genreIds = genres;
    }
    const rt = posInt(rec.runtime);
    if (rt && rt <= 600) entry.runtime = rt;
    out.push(entry);
  }
  return out;
}

function sanitizeStoredProfile(username: string, raw: unknown): UserProfileData {
  if (!raw || typeof raw !== "object") return emptyProfile(username);
  const rec = raw as Record<string, unknown>;
  const storedUpdatedAt = Number(rec.updatedAt);
  const clean = mergeProfileData(emptyProfile(username), {
    avatar: sanitizeAvatar(rec.avatar),
    progress: sanitizeProgressMap(rec.progress),
    watched: sanitizeWatchedMap(rec.watched),
    myList: sanitizeMyListMap(rec.myList),
    removedMyList: sanitizeRemovedMyListMap(rec.removedMyList),
    history: sanitizeHistoryList(rec.history),
  });
  clean.updatedAt = Number.isFinite(storedUpdatedAt) && storedUpdatedAt > 0 ? storedUpdatedAt : 0;
  return clean;
}

/**
 * Merge incoming device state into existing cloud profile using per-item timestamps
 * and removal tombstones so Web and TV never overwrite newer progress or resurrect
 * explicitly deleted My List titles.
 */
export function mergeProfileData(
  existing: UserProfileData,
  incoming: ProfilePatch,
): UserProfileData {
  const now = Date.now();
  const inWatched = sanitizeWatchedMap(incoming.watched);
  const inProgress = sanitizeProgressMap(incoming.progress);
  const inMyList = sanitizeMyListMap(incoming.myList);
  const inRemoved = sanitizeRemovedMyListMap(incoming.removedMyList);
  const inHistory = sanitizeHistoryList(incoming.history);

  const watchedMerged: Record<string, number> = { ...existing.watched };
  for (const [k, ts] of Object.entries(inWatched)) {
    watchedMerged[k] = Math.max(watchedMerged[k] || 0, ts);
  }
  const watchedCapped: Record<string, number> = {};
  for (const k of Object.keys(watchedMerged)
    .sort((a, b) => watchedMerged[b] - watchedMerged[a])
    .slice(0, MAX_WATCHED)) {
    watchedCapped[k] = watchedMerged[k];
  }

  const clearSet = new Set<string>(
    Array.isArray(incoming.clearProgressKeys)
      ? incoming.clearProgressKeys.filter((k): k is string => typeof k === "string")
      : [],
  );

  const progressKeys = new Set([...Object.keys(existing.progress), ...Object.keys(inProgress)]);
  const progressList: ProfileProgressEntry[] = [];
  for (const k of progressKeys) {
    if (clearSet.has(k)) continue;
    const a = existing.progress[k];
    const b = inProgress[k];
    const chosen = a && b ? (b.updated >= a.updated ? b : a) : b || a;
    if (!chosen) continue;
    // Drop stale partial progress once that exact item/episode was completed afterward.
    const watchedAt = watchedCapped[k] || 0;
    if (watchedAt >= chosen.updated) continue;
    progressList.push(chosen);
  }
  progressList.sort((a, b) => b.updated - a.updated);
  const progressCapped: Record<string, ProfileProgressEntry> = {};
  for (const en of progressList.slice(0, MAX_PROGRESS)) {
    progressCapped[`${en.type}:${en.id}:${en.s}:${en.e}`] = en;
  }

  const allListKeys = new Set([
    ...Object.keys(existing.myList),
    ...Object.keys(inMyList),
    ...Object.keys(existing.removedMyList),
    ...Object.keys(inRemoved),
  ]);
  const keptList: ProfileMyListEntry[] = [];
  const keptRemoved: Array<[string, number]> = [];
  for (const k of allListKeys) {
    const a = existing.myList[k];
    const b = inMyList[k];
    const bestAdd = a && b ? (b.added >= a.added ? b : a) : b || a;
    const bestRemove = Math.max(existing.removedMyList[k] || 0, inRemoved[k] || 0);
    if (bestAdd && bestAdd.added >= bestRemove) {
      keptList.push(bestAdd);
    } else if (bestRemove > 0) {
      keptRemoved.push([k, bestRemove]);
    }
  }
  keptList.sort((a, b) => b.added - a.added);
  const myListCapped: Record<string, ProfileMyListEntry> = {};
  for (const en of keptList.slice(0, MAX_MYLIST)) {
    myListCapped[`${en.type}:${en.id}`] = en;
  }
  keptRemoved.sort((a, b) => b[1] - a[1]);
  const removedCapped: Record<string, number> = {};
  for (const [k, ts] of keptRemoved.slice(0, MAX_REMOVED_MYLIST)) {
    removedCapped[k] = ts;
  }

  const historyByTitle = new Map<string, ProfileHistoryEntry>();
  for (const en of [...existing.history, ...inHistory]) {
    const tk = `${en.type}:${en.id}`;
    const prev = historyByTitle.get(tk);
    if (!prev || en.at >= prev.at) {
      historyByTitle.set(tk, en);
    }
  }
  const historyCapped = [...historyByTitle.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_HISTORY);

  const avatar = sanitizeAvatar(incoming.avatar) || sanitizeAvatar(existing.avatar);

  return {
    username: existing.username,
    updatedAt: Math.max(existing.updatedAt || 0, Number(incoming.updatedAt) || 0, now),
    ...(avatar ? { avatar } : {}),
    progress: progressCapped,
    watched: watchedCapped,
    myList: myListCapped,
    removedMyList: removedCapped,
    history: historyCapped,
  };
}

async function ensureProfileTable(env: Env): Promise<D1Database | null> {
  const db = (env as { DB?: D1Database }).DB;
  if (!db || typeof db.prepare !== "function") return null;
  if (!initializedDbs.has(db)) {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS user_profiles (username TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
      )
      .run();
    initializedDbs.add(db);
  }
  return db;
}

export async function getProfile(
  env: Env,
  username: string,
): Promise<{ exists: boolean; profile: UserProfileData }> {
  let d1Profile: UserProfileData | null = null;
  try {
    const db = await ensureProfileTable(env);
    if (db) {
      const row = await db
        .prepare("SELECT data_json FROM user_profiles WHERE username = ?")
        .bind(username)
        .first<{ data_json?: string }>();
      if (row && typeof row.data_json === "string") {
        d1Profile = sanitizeStoredProfile(username, JSON.parse(row.data_json));
      }
    }
  } catch {
    /* D1 unavailable or mock omits SQL: fall back to KV */
  }

  let kvProfile: UserProfileData | null = null;
  try {
    const raw = await env.CACHE?.get(profileCacheKey(username));
    if (raw) {
      kvProfile = sanitizeStoredProfile(username, JSON.parse(raw));
    }
  } catch {
    /* invalid cached JSON */
  }

  if (d1Profile && kvProfile) {
    return {
      exists: true,
      profile: kvProfile.updatedAt > d1Profile.updatedAt ? kvProfile : d1Profile,
    };
  }
  const found = d1Profile || kvProfile;
  if (found) return { exists: true, profile: found };
  return { exists: false, profile: emptyProfile(username) };
}

export async function saveProfile(
  env: Env,
  username: string,
  patch: ProfilePatch,
): Promise<UserProfileData> {
  const { profile: current } = await getProfile(env, username);
  const merged = mergeProfileData(current, patch);
  const json = JSON.stringify(merged);

  let savedToD1 = false;
  try {
    const db = await ensureProfileTable(env);
    if (db) {
      await db
        .prepare(
          "INSERT INTO user_profiles (username, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
        )
        .bind(username, json, merged.updatedAt)
        .run();
      savedToD1 = true;
    }
  } catch {
    /* KV mirror still preserves profile if D1 fails */
  }

  // KV is only a fallback when D1 is unavailable: profile saves (watch
  // progress, my list) happen on every sync and would burn the free KV
  // quota of 1,000 writes/day. getProfile prefers the newer of D1/KV, so a
  // stale KV copy never shadows a newer D1 row.
  if (!savedToD1) {
    try {
      await env.CACHE?.put(profileCacheKey(username), json, {
        expirationTtl: PROFILE_TTL_SECONDS,
      });
    } catch {
      /* ignore KV write failure */
    }
  }

  return merged;
}

// ---- Optional 4-digit PIN protection for a profile ----------------------
// The PIN is never stored: only an HMAC keyed by SIGNING_SECRET is kept in KV
// (written once when the PIN is set), so a KV leak alone reveals nothing.
// Wrong guesses are rate limited per username.
const PIN_KEY_PREFIX = "pin:v1:";
const PIN_FAIL_PREFIX = "pinfail:v1:";
const PIN_MAX_FAILS = 8;
const PIN_FAIL_WINDOW_SECONDS = 15 * 60;

export function isValidPin(raw: unknown): raw is string {
  return typeof raw === "string" && /^\d{4}$/.test(raw);
}

async function pinMac(env: Env, username: string, pin: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(env.SIGNING_SECRET || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`pin|${username}|${pin}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function profileHasPin(env: Env, username: string): Promise<boolean> {
  try {
    return Boolean(await env.CACHE?.get(`${PIN_KEY_PREFIX}${username}`));
  } catch {
    return false;
  }
}

export async function setProfilePin(env: Env, username: string, pin: string): Promise<void> {
  await env.CACHE?.put(`${PIN_KEY_PREFIX}${username}`, await pinMac(env, username, pin));
  try {
    await env.CACHE?.delete(`${PIN_FAIL_PREFIX}${username}`);
  } catch {
    /* ignore */
  }
}

export type PinCheck = "ok" | "no_pin" | "bad" | "too_many";

/** Check a PIN against a protected profile (no_pin when the profile has none). */
export async function checkProfilePin(env: Env, username: string, pin: unknown): Promise<PinCheck> {
  const stored = await env.CACHE?.get(`${PIN_KEY_PREFIX}${username}`);
  if (!stored) return "no_pin";
  const failKey = `${PIN_FAIL_PREFIX}${username}`;
  const fails = Number((await env.CACHE?.get(failKey)) || 0) || 0;
  if (fails >= PIN_MAX_FAILS) return "too_many";
  if (isValidPin(pin) && (await pinMac(env, username, pin)) === stored) return "ok";
  // Only wrong non-empty guesses count: a missing PIN is just a locked prompt.
  if (isValidPin(pin)) {
    try {
      await env.CACHE?.put(failKey, String(fails + 1), { expirationTtl: PIN_FAIL_WINDOW_SECONDS });
    } catch {
      /* ignore */
    }
  }
  return "bad";
}
