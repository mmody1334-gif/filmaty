import type { Env } from "../env.ts";
import { edgeDelete, edgeGet, edgePut } from "./edge-cache.ts";

export interface ArchiveEntry {
  id?: number;
  userId: string;
  title: string;
  kind: "movie" | "series";
  season?: number;
  episode?: number;
  quality?: string;
  host?: string;
  site?: string;
  url: string;
  createdAt: number;
}

export interface UserSession {
  chatId: number;
  query: string;
  kind: "movie" | "series" | "all";
  step: "results" | "seasons" | "episodes" | "qualities" | "servers";
  selectedCandidate?: any;
  selectedSeason?: number;
  selectedEpisode?: number;
  selectedQuality?: string;
  timestamp: number;
}

export class AppStore {
  private env: Env;
  private static memStore = new Map<string, { value: string; expiresAt: number }>();

  constructor(env: Env) {
    this.env = env;
  }

  async setSession(chatId: number, session: Partial<UserSession>): Promise<void> {
    const key = `session:${chatId}`;
    const existing = (await this.getSession(chatId)) || {
      chatId,
      query: "",
      kind: "all",
      step: "results",
      timestamp: Date.now(),
    };
    const updated = { ...existing, ...session, timestamp: Date.now() };
    await this.put(key, JSON.stringify(updated), 3600);
  }

  async getSession(chatId: number): Promise<UserSession | null> {
    const key = `session:${chatId}`;
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserSession;
    } catch {
      return null;
    }
  }

  async clearSession(chatId: number): Promise<void> {
    const key = `session:${chatId}`;
    await edgeDelete(key, this.env?.CACHE);
    AppStore.memStore.delete(key);
  }

  async delete(key: string): Promise<void> {
    await edgeDelete(key, this.env?.CACHE);
    AppStore.memStore.delete(key);
  }

  // Bot sessions and navigation state are short-lived (<= 1h) and written on
  // almost every button press, so they live in the edge cache (Cache API, no
  // write quota) instead of Workers KV (free plan: 1,000 writes/day).
  // Telegram webhooks reach the same colo, so edge-cache locality is fine.
  // Reads still fall back to KV for entries written before this change.
  async put(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    const hasEdge = !!(globalThis as { caches?: CacheStorage }).caches?.default;
    if (hasEdge || this.env?.CACHE) {
      await edgePut(key, value, ttlSeconds, this.env?.CACHE);
      return;
    }
    AppStore.memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get(key: string): Promise<string | null> {
    const edgeVal = await edgeGet(key, this.env?.CACHE);
    if (edgeVal !== null) return edgeVal;
    if (this.env?.CACHE && (globalThis as { caches?: CacheStorage }).caches?.default) {
      try {
        const val = await this.env.CACHE.get(key);
        if (val !== null) return val;
      } catch {}
    }
    const item = AppStore.memStore.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      AppStore.memStore.delete(key);
      return null;
    }
    return item.value;
  }

  async setCache<T>(key: string, value: T, ttlSeconds = 1800): Promise<void> {
    await this.put(key, JSON.stringify(value), ttlSeconds);
  }

  async getCache<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  // --- D1 Personal Archive Operations ---

  async addToArchive(item: Omit<ArchiveEntry, "id" | "createdAt">): Promise<boolean> {
    if (!this.env.DB) return false;
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.env.DB.prepare(
        `INSERT INTO archive (user_id, title, kind, season, episode, quality, host, site, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          item.userId,
          item.title,
          item.kind,
          item.season || null,
          item.episode || null,
          item.quality || null,
          item.host || null,
          item.site || null,
          item.url,
          now,
        )
        .run();
      return true;
    } catch (err) {
      console.error("D1 archive insert error:", err);
      return false;
    }
  }

  async listArchive(userId: string, limit = 20): Promise<ArchiveEntry[]> {
    if (!this.env.DB) return [];
    try {
      const res = await this.env.DB.prepare(
        `SELECT id, user_id as userId, title, kind, season, episode, quality, host, site, url, created_at as createdAt
         FROM archive
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
        .bind(userId, limit)
        .all<ArchiveEntry>();
      return res.results || [];
    } catch (err) {
      console.error("D1 archive select error:", err);
      return [];
    }
  }
}
