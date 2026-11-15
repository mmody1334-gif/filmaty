import type { Env } from "../env.ts";

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
    await this.env.CACHE.put(key, JSON.stringify(updated), { expirationTtl: 3600 }); // 1 hour session
  }

  async getSession(chatId: number): Promise<UserSession | null> {
    const key = `session:${chatId}`;
    try {
      return await this.env.CACHE.get<UserSession>(key, "json");
    } catch {
      return null;
    }
  }

  async clearSession(chatId: number): Promise<void> {
    await this.env.CACHE.delete(`session:${chatId}`);
  }

  async put(key: string, value: string, ttlSeconds = 3600): Promise<void> {
    try {
      await this.env.CACHE.put(key, value, { expirationTtl: ttlSeconds });
    } catch (err) {
      console.error(`KV put error for key ${key}:`, err);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.env.CACHE.get(key);
    } catch {
      return null;
    }
  }

  async setCache<T>(key: string, value: T, ttlSeconds = 1800): Promise<void> {
    try {
      await this.env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    } catch {}
  }

  async getCache<T>(key: string): Promise<T | null> {
    try {
      return await this.env.CACHE.get<T>(key, "json");
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
