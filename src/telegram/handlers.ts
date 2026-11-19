import type { Env } from "../env.ts";
import { parseList, parseOwnerIds } from "../env.ts";
import { AppStore } from "../engine/store.ts";
import { signToken } from "../engine/token.ts";
import { fetchTmdbDetails, qualityMatches, resolveBestDirectStream, resolveServersByTmdb, titlesMatch, tmdbTitleOf } from "../engine/resolve.ts";
import { searchTitles, type SearchResultItem } from "../engine/search.ts";
import { botCodeKey, isBotCode, type BotCodePayload } from "../engine/botcode.ts";
import { ALL_PROVIDERS, findProvider, searchAllProviders } from "../providers/index.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, SourceLink } from "../providers/types.ts";
import { AkwamProvider } from "../providers/akwam.ts";
import {
  detectSocialPlatform,
  extractFirstUrl,
  parseYouTubePlaylist,
  parseYouTubeVideo,
} from "../social/detector.ts";
import { extractTikTok } from "../social/tiktok.ts";
import { extractInstagram } from "../social/instagram.ts";
import {
  extractYouTubeStream,
  fetchYouTubePlaylist,
  fetchYouTubeVideoDetails,
  formatDuration,
  type YouTubePlaylistResult,
} from "../social/youtube.ts";
import { TelegramClient } from "./client.ts";
import * as kb from "./keyboards.ts";
import * as views from "./views.ts";

function shortKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function extractMsgId(msg: any): number | undefined {
  if (!msg) return undefined;
  if (typeof msg.message_id === "number") return msg.message_id;
  if (msg.result && typeof msg.result.message_id === "number") return msg.result.message_id;
  return undefined;
}

// -----------------------------------------------------------------------------
// Deep-link payloads: short, always valid for Telegram start parameters
// (only A-Za-z0-9_- allowed, max 64 chars). Movie: m<tmdbId>, e.g. m550.
// Series: t<tmdbId> or t<tmdbId>s<season>e<episode>, e.g. t1399s1e3.
// -----------------------------------------------------------------------------

export interface StartPayload {
  type: "movie" | "tv";
  tmdbId: number;
  season?: number;
  episode?: number;
}

export function parseStartPayload(payload: string): StartPayload | null {
  const movie = /^m(\d+)$/.exec(payload);
  if (movie) {
    const tmdbId = Number(movie[1]);
    return tmdbId > 0 ? { type: "movie", tmdbId } : null;
  }
  const tv = /^t(\d+)(?:s(\d+)e(\d+))?$/.exec(payload);
  if (tv) {
    const tmdbId = Number(tv[1]);
    if (tmdbId <= 0) return null;
    return {
      type: "tv",
      tmdbId,
      season: tv[2] ? Number(tv[2]) : undefined,
      episode: tv[3] ? Number(tv[3]) : undefined,
    };
  }
  return null;
}

// Convert a Telegram WebApp sendData payload {type, id, s, e} (or {code})
// to the same short string form used by /start deep links. Returns null if
// invalid.
export function webAppDataToPayload(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  if (typeof data.code === "string" && isBotCode(data.code)) return data.code;
  const id = Number(data.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (data.type === "movie") return `m${id}`;
  if (data.type === "tv") {
    const s = Number(data.s);
    const e = Number(data.e);
    if (Number.isInteger(s) && s > 0 && Number.isInteger(e) && e > 0) {
      return `t${id}s${s}e${e}`;
    }
    return `t${id}`;
  }
  return null;
}

export async function handleTelegramUpdate(update: any, env: Env): Promise<Response> {
  const bot = new TelegramClient(env.BOT_TOKEN ?? "");
  const store = new AppStore(env);

  try {
    if (update.message) {
      // Telegram WebApp sendData arrives as message.web_app_data (usually
      // with no text). Route it through the same /start payload logic.
      const wad = update.message.web_app_data?.data;
      if (typeof wad === "string" && wad) {
        let payloadStr: string | null = null;
        try {
          payloadStr = webAppDataToPayload(JSON.parse(wad));
        } catch {
          payloadStr = null;
        }
        if (payloadStr) {
          await handleMessage(
            { ...update.message, text: `/start ${payloadStr}` },
            bot,
            store,
            env,
          );
          return new Response("OK", { status: 200 });
        }
      }
      await handleMessage(update.message, bot, store, env);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, bot, store, env);
    }
  } catch (err: any) {
    console.error("Telegram handler error:", err);
  }

  return new Response("OK", { status: 200 });
}

async function handleMessage(msg: any, bot: TelegramClient, store: AppStore, env: Env): Promise<void> {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const text = (msg.text || "").trim();

  if (!chatId || !text) return;

  // Authorization check if OWNER_IDS set
  const owners = parseOwnerIds(env.OWNER_IDS);
  if (owners.size > 0 && userId && !owners.has(userId)) {
    await bot.sendMessage(chatId, "⛔️ هذا البوت مخصص للاستخدام الشخصي المصرح به فقط.");
    return;
  }

  // 0. Bot code (6 chars): send the video directly, no /start needed.
  if (isBotCode(text)) {
    await handleBotCode(chatId, text, bot, store, env);
    return;
  }

  // 1. Social Media Links Auto-Detection
  const firstUrl = extractFirstUrl(text);
  if (firstUrl) {
    const platform = detectSocialPlatform(firstUrl);
    if (platform === "tiktok") {
      await handleTikTok(firstUrl, chatId, bot, store);
      return;
    }
    if (platform === "instagram") {
      await handleInstagram(firstUrl, chatId, bot, store);
      return;
    }
    if (platform === "youtube") {
      await handleYouTube(firstUrl, chatId, bot, store);
      return;
    }
  }

  // 2. Commands
  if (text === "/start" || text.startsWith("/start ")) {
    const payload = text === "/start" ? "" : text.slice("/start".length).trim();
    if (!payload) {
      await bot.sendMessage(chatId, views.formatWelcome(), {
        reply_markup: kb.buildMainMenuKeyboard(),
      });
      return;
    }
    const parsed = parseStartPayload(payload);
    if (parsed) {
      await handleStartPayload(chatId, parsed, bot, store, env);
      return;
    }
    // A 6-char bot code as a /start payload (start=CODE): same direct send.
    if (isBotCode(payload)) {
      await handleBotCode(chatId, payload, bot, store, env);
      return;
    }
    // Payload that does not match m/t form: treat it as a plain search query.
    await executeSearch(chatId, payload, undefined, bot, store, env);
    return;
  }

  if (text === "/archive") {
    const items = await store.listArchive(String(userId || chatId));
    await bot.sendMessage(chatId, views.formatArchive(items), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }

  if (text === "/status") {
    const active = ALL_PROVIDERS.map((p) => p.label);
    await bot.sendMessage(chatId, views.formatStatus(active), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }

  // /app: open the Filmaty web app (or TV mode) inside Telegram.
  if (text === "/app" || text.startsWith("/app ") || text.startsWith("/app@")) {
    await bot.sendMessage(chatId, views.formatAppMessage(), {
      reply_markup: kb.buildAppKeyboard(),
    });
    return;
  }

  // /film or /movie command
  if (text.startsWith("/film") || text.startsWith("/movie")) {
    const query = text.replace(/^\/(?:film|movie)\s*/i, "").trim();
    if (!query) {
      await bot.sendMessage(chatId, "🎬 أرسل اسم الفيلم للبحث (مثال: <code>marvel</code> أو <code>Interstellar</code>):");
      return;
    }
    await executeSearch(chatId, query, "movie", bot, store, env);
    return;
  }

  // /series command
  if (text.startsWith("/series")) {
    const query = text.replace(/^\/series\s*/i, "").trim();
    if (!query) {
      await bot.sendMessage(chatId, "📺 أرسل اسم المسلسل للبحث (مثال: <code>Breaking Bad</code> أو <code>Game of Thrones</code>):");
      return;
    }
    await executeSearch(chatId, query, "series", bot, store, env);
    return;
  }

  // Direct text query (search across all movies & series)
  await executeSearch(chatId, text, undefined, bot, store, env);
}

// -----------------------------------------------------------------------------
// Social Media Handlers (TikTok, Instagram, YouTube)
// -----------------------------------------------------------------------------

async function handleTikTok(url: string, chatId: number, bot: TelegramClient, _store: AppStore): Promise<void> {
  const status = await bot.sendMessage(chatId, "⏳ جاري فحص وتحميل فيديو TikTok...");
  const statusId = extractMsgId(status);
  try {
    const result = await extractTikTok(url);
    const caption = `🎵 <b>${views.escapeHtml(result.title)}</b>\n👤 <b>${views.escapeHtml(result.author || "TikTok")}</b>`;
    const keyboard = kb.buildTikTokKeyboard(result.hdVideoUrl || result.sdVideoUrl, result.audioUrl);

    // If SD video exists and is within 25MB, send directly to Telegram chat
    const targetVideo = result.sdVideoUrl || result.hdVideoUrl;
    if (targetVideo && (!result.size || result.size < 30 * 1024 * 1024)) {
      await bot.sendVideo(chatId, targetVideo, caption, { reply_markup: keyboard });
      if (statusId) await bot.deleteMessage(chatId, statusId).catch(() => undefined);
      return;
    }

    // Otherwise send photo card with direct download buttons
    if (result.thumbnail) {
      await bot.sendPhoto(chatId, result.thumbnail, caption, { reply_markup: keyboard });
      if (statusId) await bot.deleteMessage(chatId, statusId).catch(() => undefined);
      return;
    }

    await bot.safeEdit(chatId, statusId, caption, { reply_markup: keyboard });
  } catch (err: any) {
    await bot.safeEdit(chatId, statusId, `❌ تعذر تحميل فيديو TikTok:\n<code>${views.escapeHtml(err.message)}</code>`);
  }
}

async function handleInstagram(url: string, chatId: number, bot: TelegramClient, _store: AppStore): Promise<void> {
  const status = await bot.sendMessage(chatId, "⏳ جاري فحص وتحميل محتوى Instagram...");
  const statusId = extractMsgId(status);
  try {
    const result = await extractInstagram(url);
    const caption = `📸 <b>${views.escapeHtml(result.title)}</b>\n👤 <b>${views.escapeHtml(result.author ? `@${result.author}` : "Instagram")}</b>`;
    const keyboard = kb.buildInstagramKeyboard(result.videoUrl || result.images?.[0]);

    if (result.videoUrl) {
      await bot.sendVideo(chatId, result.videoUrl, caption, { reply_markup: keyboard });
      if (statusId) await bot.deleteMessage(chatId, statusId).catch(() => undefined);
      return;
    }

    if (result.images && result.images.length > 0) {
      await bot.sendPhoto(chatId, result.images[0], caption, { reply_markup: keyboard });
      if (statusId) await bot.deleteMessage(chatId, statusId).catch(() => undefined);
      return;
    }

    await bot.safeEdit(chatId, statusId, caption, { reply_markup: keyboard });
  } catch (err: any) {
    await bot.safeEdit(chatId, statusId, `❌ تعذر تحميل محتوى Instagram:\n<code>${views.escapeHtml(err.message)}</code>`);
  }
}

async function handleYouTube(url: string, chatId: number, bot: TelegramClient, store: AppStore): Promise<void> {
  // 1. YouTube Playlist
  const plTarget = parseYouTubePlaylist(url);
  if (plTarget) {
    const status = await bot.sendMessage(chatId, "⏳ جاري قراءة قائمة تشغيل YouTube (Playlist)...");
    const statusId = extractMsgId(status);
    try {
      const pl = await fetchYouTubePlaylist(plTarget.playlistId);
      if (!pl.items.length) {
        throw new Error("قائمة التشغيل فارغة أو خاصة.");
      }

      const key = shortKey();
      await store.put(`ytpl:${key}`, JSON.stringify(pl), 3600);

      const text = `📋 <b>قائمة تشغيل يوتيوب (Playlist):</b>
🎬 <b>${views.escapeHtml(pl.title)}</b>
👤 <b>القناة:</b> ${views.escapeHtml(pl.author)}
🔢 <b>عدد الفيديوهات:</b> ${pl.videoCount}

👇 اضغط على أي فيديو لعرض خيارات تحميله:`;

      const keyboard = kb.buildYouTubePlaylistKeyboard(key, 0, 5, pl.videoCount, pl.items);
      await bot.safeEdit(chatId, statusId, text, { reply_markup: keyboard });
      return;
    } catch (err: any) {
      await bot.safeEdit(chatId, statusId, `❌ تعذر قراءة قائمة التشغيل:\n<code>${views.escapeHtml(err.message)}</code>`);
      return;
    }
  }

  // 2. YouTube Single Video
  const vTarget = parseYouTubeVideo(url);
  if (vTarget) {
    const status = await bot.sendMessage(chatId, "⏳ جاري فحص فيديو YouTube...");
    const statusId = extractMsgId(status);
    try {
      const details = await fetchYouTubeVideoDetails(vTarget.videoId);
      const key = shortKey();
      await store.put(`ytv:${key}`, JSON.stringify({ ...details, url }), 3600);

      const text = `▶️ <b>YouTube:</b> ${views.escapeHtml(details.title)}
👤 <b>القناة:</b> ${views.escapeHtml(details.author)}
⏱ <b>المدة:</b> ${formatDuration(details.duration)}

👇 اختر صيغة التحميل:`;

      const keyboard = kb.buildYouTubeFormatKeyboard(key);
      if (details.thumbnail) {
        await bot.sendPhoto(chatId, details.thumbnail, text, { reply_markup: keyboard });
        if (statusId) await bot.deleteMessage(chatId, statusId).catch(() => undefined);
      } else {
        await bot.safeEdit(chatId, statusId, text, { reply_markup: keyboard });
      }
      return;
    } catch (err: any) {
      await bot.safeEdit(chatId, statusId, `❌ تعذر قراءة فيديو YouTube:\n<code>${views.escapeHtml(err.message)}</code>`);
      return;
    }
  }

  await bot.sendMessage(chatId, "🚫 هذا الرابط غير مدعوم.");
}

// -----------------------------------------------------------------------------
// Movie & Series Search & Flow
// -----------------------------------------------------------------------------

// A deep link's requested episode, stored under `pref_ep:<chatId>` by
// handleStartPayload and consumed by the search-result pick handler so
// the episode's quality list opens directly instead of the picker.
interface PrefEpisode {
  tmdbId: number;
  season: number;
  episode: number;
  title?: string;
  originalTitle?: string;
}

async function readPrefEpisode(store: AppStore, chatId: number): Promise<PrefEpisode | null> {
  try {
    const raw = await store.get(`pref_ep:${chatId}`);
    if (!raw) return null;
    const pref = JSON.parse(raw) as PrefEpisode;
    if (typeof pref.season !== "number" || typeof pref.episode !== "number") return null;
    return pref;
  } catch {
    return null;
  }
}

function prefMatchesCandidate(pref: PrefEpisode, candidate: Candidate): boolean {
  // Exact TMDB id when the candidate carries one (unified engine path).
  if (candidate.tmdbId !== undefined && pref.tmdbId !== undefined) {
    return candidate.tmdbId === pref.tmdbId;
  }
  // Strict title match for raw provider-search results (no TMDB id).
  return Boolean(
    (pref.title && titlesMatch(candidate.title, pref.title)) ||
      (pref.originalTitle && titlesMatch(candidate.title, pref.originalTitle)) ||
      (pref.title && titlesMatch(pref.title, candidate.title)),
  );
}

// Handle a /start deep-link payload (m<tmdbId> / t<tmdbId>[s..e..]): look the
// title up on TMDB (English first) and run the normal search flow for it.
async function handleStartPayload(
  chatId: number,
  payload: StartPayload,
  bot: TelegramClient,
  store: AppStore,
  env: Env,
): Promise<void> {
  const enData = await fetchTmdbDetails(env, payload.type, payload.tmdbId, "en-US");
  let tmdbTitle = tmdbTitleOf(enData, payload.type);
  if (!tmdbTitle) {
    const arData = await fetchTmdbDetails(env, payload.type, payload.tmdbId, "ar");
    tmdbTitle = tmdbTitleOf(arData, payload.type);
  }
  if (!tmdbTitle) {
    await bot.sendMessage(chatId, "❌ تعذر العثور على هذا العمل.");
    return;
  }

  // Remember the requested season/episode so the episode picker can open
  // on it (best effort; the normal search flow runs regardless). The titles
  // are stored too so a picked result can be matched even when it carries
  // no TMDB id (raw provider-search fallback).
  if (
    payload.type === "tv" &&
    payload.season !== undefined &&
    payload.episode !== undefined
  ) {
    await store.put(
      `pref_ep:${chatId}`,
      JSON.stringify({
        tmdbId: payload.tmdbId,
        season: payload.season,
        episode: payload.episode,
        title: tmdbTitle.title,
        originalTitle: tmdbTitle.originalTitle,
      }),
      3600,
    );
  }

  // No status message here: executeSearch sends its own. The old code
  // sent one too, so every /start deep link showed "جاري البحث" twice.
  await executeSearch(
    chatId,
    tmdbTitle.originalTitle,
    payload.type === "tv" ? "series" : "movie",
    bot,
    store,
    env,
  );
}

// Handle a 6-char bot code: look it up in KV and send that exact
// title/episode/quality directly with bot.sendVideo — same caption,
// buttons, status message and >50MB fallback as the mov|send| flow.
// No /start needed; an unknown/expired code gets the error reply only.
async function handleBotCode(
  chatId: number,
  code: string,
  bot: TelegramClient,
  store: AppStore,
  env: Env,
): Promise<void> {
  const raw = await store.get(botCodeKey(code));
  if (!raw) {
    await bot.sendMessage(chatId, "❌ الكود غير صحيح أو انتهت صلاحيته");
    return;
  }
  const payload = JSON.parse(raw) as BotCodePayload;
  const resolved = await resolveServersByTmdb(
    env,
    payload.type,
    payload.tmdbId,
    payload.season,
    payload.episode,
  );
  const qualities = resolved?.servers?.[0]?.qualities || [];
  const wantedQuality = payload.quality;
  const quality = wantedQuality
    ? qualities.find((q) => qualityMatches(q.quality, wantedQuality))
    : qualities[0];
  if (!resolved || !quality) {
    await bot.sendMessage(chatId, "❌ تعذر العثور على هذا العمل — قد يكون الرابط غير متاح حاليًا.");
    return;
  }

  const title =
    resolved.title +
    (payload.type === "tv" && payload.season && payload.episode
      ? ` - S${payload.season}E${payload.episode}`
      : "");
  const statusMsg = await bot.sendMessage(
    chatId,
    `⏳ <b>جاري إرسال الفيديو مباشرة داخل شات التليجرام...</b>\n🎬 <b>${views.escapeHtml(title)}</b>\n🎯 الجودة: <b>${quality.quality}</b>\n<i>يرجى الانتظار بضع ثوانٍ بينما يقوم سيرفر التليجرام بالمعالجة...</i>`,
  );
  const statusMsgId = extractMsgId(statusMsg);

  const caption = `🎬 <b>${views.escapeHtml(title)}</b>\n🎯 الجودة: <b>${quality.quality}</b>${quality.size ? ` • 📦 ${quality.size}` : ""}\n\n🍿 مشاهدة ممتعة عبر بوت فيلماتي!`;
  const videoKeyboard = {
    inline_keyboard: [
      [{ text: "⬇️ رابط التحميل المباشر (.mp4)", url: quality.directVideoUrl }],
    ],
  };

  try {
    const res = await bot.sendVideo(chatId, quality.directVideoUrl, caption, {
      reply_markup: videoKeyboard,
    });

    if (res && (res.ok || res.message_id)) {
      if (statusMsgId) await bot.deleteMessage(chatId, statusMsgId).catch(() => undefined);
      return;
    }
    throw new Error(res?.description || "Failed to send video directly");
  } catch (err: any) {
    if (statusMsgId) await bot.deleteMessage(chatId, statusMsgId).catch(() => undefined);
    const watchUrl = await buildWatchPlayerUrl(env, quality.directVideoUrl, title);
    await bot.sendMessage(
      chatId,
      `⚠️ <b>تنبيه من سيرفرات التليجرام:</b>
حجم الفيديو كبير (أكبر من 50MB) أو قيود سيرفر التليجرام تمنع استيراده تلقائياً في الشات.

👇 <b>يمكنك تحميله فوراً وبأقصى سرعة (.mp4) أو تشغيله مباشرة:</b>`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬇️ تحميل مباشر (.mp4)", url: quality.directVideoUrl }],
            [{ text: "▶️ مشاهدة مباشرة أونلاين", url: watchUrl || quality.directVideoUrl }],
          ],
        },
      },
    );
  }
}

async function buildWatchPlayerUrl(
  env: Env,
  directVideoUrl: string,
  title: string,
): Promise<string | undefined> {
  if (!env.SIGNING_SECRET) return undefined;
  const publicBase = (env.PUBLIC_BASE || "https://filmaty.hudhaifa-bio.workers.dev").replace(/\/+$/, "");
  const token = await signToken(
    {
      u: directVideoUrl,
      n: title,
      k: directVideoUrl.includes(".m3u8") ? "hls" : "mp4",
      e: Math.floor(Date.now() / 1000) + 14400,
    },
    env.SIGNING_SECRET,
  );
  return `${publicBase}/watch?t=${encodeURIComponent(token)}`;
}

// Attach a provider candidate to one unified-engine title (search
// rebuild, stage 2): the bot's details/send flow needs a real provider
// candidate (site + url), so each engine title is matched against a
// provider search for that title — same pattern as the resolver
// (fetchResolveCandidates): English title first, strict titlesMatch,
// Arabic fallback. Returns null when no provider has the title; the
// caller drops such titles (the bot can only serve what providers have).
// Display fields (title/year/poster) come from the TMDB item so the bot
// shows the same titles the site shows.
// Shape a provider candidate as a bot result for one engine title: the
// display title/year/poster come from TMDB, the playable link from the
// provider, and the TMDB id lets the pick flow resolve the title.
function toAttachedCandidate(match: Candidate, item: SearchResultItem): Candidate {
  const kind: MediaKind = item.media_type === "tv" ? "series" : "movie";
  const arTitle = item.title || item.name || "";
  const year =
    Number((item.release_date || item.first_air_date || "").slice(0, 4)) || undefined;
  return {
    ...match,
    title: arTitle,
    year: year || match.year,
    kind,
    tmdbId: item.id ?? undefined,
    poster: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : match.poster,
  };
}

function attachTitles(item: SearchResultItem): string[] {
  const enTitle = item.original_title || item.original_name || item.title || item.name || "";
  const arTitle = item.title || item.name || "";
  return enTitle && enTitle !== arTitle ? [enTitle, arTitle] : [enTitle || arTitle];
}

// Match one engine title against an already-fetched provider pool (no
// network): the same English-first, then Arabic, strict titlesMatch the
// per-title attach uses — so one provider sweep can attach many titles
// instead of one sweep per title.
function matchPoolCandidate(pool: Candidate[], item: SearchResultItem): Candidate | null {
  const kind: MediaKind = item.media_type === "tv" ? "series" : "movie";
  for (const t of attachTitles(item)) {
    if (!t) continue;
    const match = pool.find((c) => c.kind === kind && titlesMatch(c.title, t));
    if (match) return toAttachedCandidate(match, item);
  }
  return null;
}

async function attachProviderCandidate(
  env: Env,
  item: SearchResultItem,
  disabled: string[],
  onlySites?: string[],
  searchOpts?: { pages?: number },
): Promise<Candidate | null> {
  const kind: MediaKind = item.media_type === "tv" ? "series" : "movie";
  for (const t of attachTitles(item)) {
    if (!t) continue;
    const candidates = await searchAllProviders(t, kind, disabled, false, onlySites, searchOpts);
    const match = candidates.find((c) => titlesMatch(c.title, t));
    if (match) return toAttachedCandidate(match, item);
  }
  return null;
}

// Bot search, budget-capped (Mohamed: the 10 closest results, Worker
// requests ≤ 50). The old flow ran one full 9-provider sweep per engine
// title, 8 of them in parallel — ~140 subrequests for "Spartacus" against
// the Worker's ~50 cap, so the search died mid-flight and the bot never
// answered at all. Now: the unified engine (augmentation off — the bot
// runs its own sweep below), ONE shared provider sweep for the query,
// local matching against the engine's top 10, then at most 6 per-title
// top-ups on the direct providers only. Measured live for Spartacus:
// ~13 fetches for the whole search (was ~140); Marvel ~33 (was ~140).
// The pool itself is the last resort when nothing attaches, so the bot
// never returns less than the raw provider search did.
async function searchBotTitles(
  env: Env,
  query: string,
  kind: MediaKind | undefined,
): Promise<Candidate[]> {
  const disabled = parseList(env.PROVIDERS_DISABLED);
  const engine = await searchTitles(env, query, { augment: false });
  // The engine fell back to the providers itself (TMDB empty): its
  // results ARE the provider candidates — no second sweep needed.
  if (engine.source === "providers") {
    return (engine.results as unknown as Candidate[]).slice(0, 10);
  }
  const wanted = engine.results
    .filter(
      (r) =>
        !kind || (kind === "movie" ? r.media_type === "movie" : r.media_type === "tv"),
    )
    .slice(0, 10);
  if (wanted.length === 0) return [];

  let pool: Candidate[] = [];
  try {
    // One shared sweep, page 1 only: Akwam's uncapped fan-out (smart
    // queries × up to 9 pages) burns ~30 subrequests per call, so every
    // bot provider search is capped to the first page — the exact title
    // lives there, and the top-ups below re-try per title the same way.
    pool = await searchAllProviders(query, kind, disabled, false, undefined, { pages: 1 });
  } catch {
    pool = [];
  }
  const attached: Candidate[] = [];
  const done = new Set<SearchResultItem>();
  for (const item of wanted) {
    if (attached.length >= 10) break;
    const m = matchPoolCandidate(pool, item);
    if (m) {
      attached.push(m);
      done.add(item);
    }
  }
  // Top-up for the titles the shared sweep missed (providers only list
  // page 1 for the query): bounded to 6 attaches, direct providers only
  // (Akwam, Laroza, embed — the only ones that ever yield a usable bot
  // candidate), stopping at 10 attached. Worst case stays under the ~50
  // cap (measured live: Marvel 25 fetches with 4 top-ups; 6 costs ~8
  // more, and the sweep + engine are ~13).
  const DIRECT_SITES = ["akwam", "laroza", "embed"];
  let topUps = 0;
  for (const item of wanted) {
    if (attached.length >= 10 || topUps >= 6) break;
    if (done.has(item)) continue;
    topUps++;
    const m = await attachProviderCandidate(env, item, disabled, DIRECT_SITES, { pages: 1 });
    if (m) {
      attached.push(m);
      done.add(item);
    }
  }
  if (attached.length > 0) return attached.slice(0, 10);
  return pool.slice(0, 10);
}

async function executeSearch(
  chatId: number,
  query: string,
  kind: MediaKind | undefined,
  bot: TelegramClient,
  store: AppStore,
  env: Env,
): Promise<void> {
  // The bot must ALWAYS answer. The old flow could die mid-search and
  // leave the "searching..." message hanging forever (Spartacus, 2026-11-17:
  // three searches, no answer ever). Any failure below — including the
  // status send itself — edits the status message (or sends a fresh one
  // when there is no status to edit) instead of going silent.
  let statusId: number | undefined;
  try {
    const statusMsg = await bot.sendMessage(chatId, views.formatSearching(query, kind || "all"));
    statusId = extractMsgId(statusMsg);

    const results = await searchBotTitles(env, query, kind);

    if (results.length === 0) {
      await bot.safeEdit(chatId, statusId, views.formatNoResults(query), {
        reply_markup: kb.buildMainMenuKeyboard(),
      });
      return;
    }

    const searchKey = shortKey();
    await store.put(`mov_s:${searchKey}`, JSON.stringify({ query, results, kind }), 3600);

    const text = views.formatSearchResults(query, results.length);
    const keyboard = kb.buildSearchResultsKeyboard(results, searchKey, 0);

    // If only 1 result and has poster, show directly
    if (results.length === 1 && results[0]?.poster) {
      try {
        await bot.sendPhoto(chatId, results[0].poster, text, { reply_markup: keyboard });
        if (statusId) await bot.deleteMessage(chatId, statusId).catch(() => undefined);
        return;
      } catch {}
    }

    await bot.safeEdit(chatId, statusId, text, { reply_markup: keyboard });
  } catch {
    await bot
      .safeEdit(chatId, statusId, views.formatSearchError(), {
        reply_markup: kb.buildMainMenuKeyboard(),
      })
      .catch(() => undefined);
  }
}

// -----------------------------------------------------------------------------
// Callback Query Router
// -----------------------------------------------------------------------------

async function handleCallbackQuery(cb: any, bot: TelegramClient, store: AppStore, env: Env): Promise<void> {
  const callbackId = cb.id;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const data = cb.data || "";

  if (!chatId || !messageId) return;

  await bot.answerCallbackQuery(callbackId);

  // Main navigation
  if (data === "cmd:film") {
    await bot.sendMessage(chatId, "🎬 أرسل اسم الفيلم للبحث (مثال: <code>marvel</code> أو <code>Interstellar</code>):");
    return;
  }
  if (data === "cmd:series") {
    await bot.sendMessage(chatId, "📺 أرسل اسم المسلسل للبحث (مثال: <code>Breaking Bad</code> أو <code>Game of Thrones</code>):");
    return;
  }
  if (data === "cmd:archive") {
    const items = await store.listArchive(String(cb.from?.id || chatId));
    await bot.sendMessage(chatId, views.formatArchive(items), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }
  if (data === "cmd:status") {
    const active = ALL_PROVIDERS.map((p) => p.label);
    await bot.sendMessage(chatId, views.formatStatus(active), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }
  if (data === "nav:search" || data === "nav:menu") {
    await bot.sendMessage(chatId, views.formatWelcome(), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }

  // --- YouTube Callbacks ---
  if (data.startsWith("ytf|")) {
    const [, key, format] = data.split("|");
    const raw = await store.get(`ytv:${key}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت صلاحية الجلسة. أعد إرسال الرابط.");
      return;
    }
    const video = JSON.parse(raw);
    const isAudio = format === "audio";
    const text = `▶️ <b>${views.escapeHtml(video.title)}</b>\nاختر جودة ${isAudio ? "الصوت" : "الفيديو"} للتحميل:`;
    const keyboard = kb.buildYouTubeQualityKeyboard(key, isAudio);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  if (data.startsWith("ytb|")) {
    const [, key] = data.split("|");
    const raw = await store.get(`ytv:${key}`);
    if (!raw) return;
    const video = JSON.parse(raw);
    const text = `▶️ <b>YouTube:</b> ${views.escapeHtml(video.title)}\n👇 اختر صيغة التحميل:`;
    const keyboard = kb.buildYouTubeFormatKeyboard(key);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  if (data.startsWith("ytq|")) {
    const [, key, quality] = data.split("|");
    const raw = await store.get(`ytv:${key}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت صلاحية الجلسة. أعد إرسال الرابط.");
      return;
    }
    const video = JSON.parse(raw);
    const isAudio = ["320", "128"].includes(quality);
    const mode = isAudio ? "audio" : "video";

    await bot.safeEdit(chatId, messageId, `⏳ جاري استخراج رابط التحميل المباشر (${quality})...`);

    try {
      const stream = await extractYouTubeStream(video.videoId, mode, quality);
      const text = `✅ <b>جاهز للتحميل والمشاهدة!</b>\n${isAudio ? "🎵" : "📹"} <b>${views.escapeHtml(stream.title)}</b>\n🎯 <b>الجودة:</b> ${stream.quality}\n\n👇 <b>استخدم الرابط المباشر أدناه:</b>`;
      const keyboard = {
        inline_keyboard: [
          [{ text: `⬇️ تحميل مباشر (${stream.quality})`, url: stream.streamUrl }],
          [{ text: "▶️ تشغيل مباشر", url: stream.streamUrl }],
          [{ text: "🔙 اختيار جودة أخرى", callback_data: `ytb|${key}` }],
        ],
      };
      await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    } catch (err: any) {
      await bot.safeEdit(chatId, messageId, `❌ تعذر استخراج الرابط المباشر: ${views.escapeHtml(err.message)}`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 رجوع", callback_data: `ytb|${key}` }]],
        },
      });
    }
    return;
  }

  // YouTube Playlist Browse / Page
  if (data.startsWith("ytplp|")) {
    const [, key, pageStr] = data.split("|");
    const page = Number(pageStr) || 0;
    const raw = await store.get(`ytpl:${key}`);
    if (!raw) return;
    const pl = JSON.parse(raw) as YouTubePlaylistResult;
    const text = `📋 <b>قائمة تشغيل يوتيوب:</b> ${views.escapeHtml(pl.title)}\n🔢 عدد الفيديوهات: ${pl.videoCount}\n👇 اختر الفيديو:`;
    const keyboard = kb.buildYouTubePlaylistKeyboard(key, page, 5, pl.videoCount, pl.items);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  if (data.startsWith("ytpls|")) {
    const [, key, idxStr] = data.split("|");
    const idx = Number(idxStr) || 0;
    const raw = await store.get(`ytpl:${key}`);
    if (!raw) return;
    const pl = JSON.parse(raw) as YouTubePlaylistResult;
    const item = pl.items[idx];
    if (!item) return;

    const vKey = shortKey();
    await store.put(`ytv:${vKey}`, JSON.stringify({ videoId: item.videoId, title: item.title, author: item.author || pl.author, url: `https://www.youtube.com/watch?v=${item.videoId}` }), 3600);

    const text = `▶️ <b>YouTube:</b> ${views.escapeHtml(item.title)}\n👇 اختر صيغة التحميل:`;
    const keyboard = kb.buildYouTubeFormatKeyboard(vKey);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // --- Movie & Series Callbacks (`mov|...`) ---

  // Pagination: mov|p|{searchKey}|{page}
  if (data.startsWith("mov|p|")) {
    const [, , searchKey, pageStr] = data.split("|");
    const page = Number(pageStr) || 0;
    const raw = await store.get(`mov_s:${searchKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد كتابة اسم العمل للبحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const keyboard = kb.buildSearchResultsKeyboard(stored.results, searchKey, page);
    await bot.safeEdit(chatId, messageId, views.formatSearchResults(stored.query, stored.results.length), {
      reply_markup: keyboard,
    });
    return;
  }

  // Back to search: mov|b|{searchKey}
  if (data.startsWith("mov|b|")) {
    const [, , searchKey] = data.split("|");
    const raw = await store.get(`mov_s:${searchKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد كتابة اسم العمل للبحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const keyboard = kb.buildSearchResultsKeyboard(stored.results, searchKey, 0);
    await bot.safeEdit(chatId, messageId, views.formatSearchResults(stored.query, stored.results.length), {
      reply_markup: keyboard,
    });
    return;
  }

  // Pick search result: mov|s|{searchKey}|{idx}
  if (data.startsWith("mov|s|")) {
    const [, , searchKey, idxStr] = data.split("|");
    const idx = Number(idxStr) || 0;
    const raw = await store.get(`mov_s:${searchKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد كتابة اسم العمل للبحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const candidate: Candidate = stored.results[idx];
    if (!candidate) return;

    await bot.safeEdit(chatId, messageId, `⏳ جاري جلب تفاصيل <b>${views.escapeHtml(candidate.title)}</b>...`);

    const provider = findProvider(candidate.site) || ALL_PROVIDERS[0];
    const details = await provider.getDetails(candidate);

    const itemKey = shortKey();
    await store.put(`mov_d:${itemKey}`, JSON.stringify({ details, searchKey }), 3600);

    if (details.kind === "series" && details.seasons.length > 0) {
      // Deep-link episode preference: if the user arrived via /start
      // t<id>s<season>e<episode> and just picked this same title, skip
      // the season/episode picker and open the episode's qualities
      // directly. A mismatch (or a missing season/episode in the
      // provider data) falls through to the normal picker, and the
      // preference is only consumed when it actually fires.
      const pref = await readPrefEpisode(store, chatId);
      if (pref && prefMatchesCandidate(pref, candidate)) {
        const seasonIdx = details.seasons.findIndex((s) => s.season === pref.season);
        const season = seasonIdx >= 0 ? details.seasons[seasonIdx] : undefined;
        const epIdx = season?.episodes.findIndex((e) => e.episode === pref.episode) ?? -1;
        if (season && epIdx >= 0) {
          await store.delete(`pref_ep:${chatId}`);
          const ep = season.episodes[epIdx];
          await bot.safeEdit(chatId, messageId, `⏳ جاري جلب جودات <b>${views.escapeHtml(ep.title)}</b>...`);
          const epSources = await provider.getEpisodeSources(ep);
          const epKey = shortKey();
          await store.put(`mov_e:${epKey}`, JSON.stringify({ ep, epSources, itemKey, details, seasonIdx }), 3600);
          const text = views.formatEpisodeDetails(details.title, ep.title);
          const keyboard = kb.buildEpisodeQualitiesKeyboard(epKey, itemKey, epSources);
          await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
          return;
        }
      }

      if (details.seasons.length > 1) {
        // Multi-season series: show season picker first
        const text = views.formatSeriesSeasons(details);
        const keyboard = kb.buildSeriesSeasonsKeyboard(itemKey, searchKey, details.seasons);
        if (details.poster) {
          try {
            await bot.sendPhoto(chatId, details.poster, text, { reply_markup: keyboard });
            await bot.deleteMessage(chatId, messageId).catch(() => undefined);
            return;
          } catch {}
        }
        await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
        return;
      }

      // Single season: show episodes directly
      const episodes = details.seasons[0].episodes;
      const text = views.formatSeriesDetails(details, details.seasons[0].season);
      const keyboard = kb.buildSeriesEpisodesKeyboard(itemKey, searchKey, episodes, 0, false);

      if (details.poster) {
        try {
          await bot.sendPhoto(chatId, details.poster, text, { reply_markup: keyboard });
          await bot.deleteMessage(chatId, messageId).catch(() => undefined);
          return;
        } catch {}
      }
      await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
      return;
    }

    // Movie flow
    const text = views.formatFilmDetails(details);
    const keyboard = kb.buildMovieDetailsKeyboard(itemKey, searchKey, details.sources);

    if (details.poster) {
      try {
        await bot.sendPhoto(chatId, details.poster, text, { reply_markup: keyboard });
        await bot.deleteMessage(chatId, messageId).catch(() => undefined);
        return;
      } catch {}
    }
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // Pick series season: mov|sn|{itemKey}|{seasonIdx}
  if (data.startsWith("mov|sn|")) {
    const [, , itemKey, sIdxStr] = data.split("|");
    const sIdx = Number(sIdxStr) || 0;
    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد البحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    const season = details.seasons?.[sIdx];
    if (!season) return;

    const text = views.formatSeriesDetails(details, season.season);
    const keyboard = kb.buildSeriesEpisodesKeyboard(itemKey, stored.searchKey || "", season.episodes, sIdx, true);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // Back to seasons: mov|sns|{itemKey}
  if (data.startsWith("mov|sns|")) {
    const [, , itemKey] = data.split("|");
    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) return;
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    const text = views.formatSeriesSeasons(details);
    const keyboard = kb.buildSeriesSeasonsKeyboard(itemKey, stored.searchKey || "", details.seasons);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // Pick series episode: mov|e|{itemKey}|{seasonIdx}|{epIdx} OR mov|e|{itemKey}|{epIdx}
  if (data.startsWith("mov|e|")) {
    const parts = data.split("|");
    const itemKey = parts[2];
    let seasonIdx = 0;
    let epIdx = 0;
    if (parts.length >= 5) {
      seasonIdx = Number(parts[3]) || 0;
      epIdx = Number(parts[4]) || 0;
    } else {
      epIdx = Number(parts[3]) || 0;
    }

    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد البحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    const season = details.seasons?.[seasonIdx] || details.seasons?.[0];
    const ep = season?.episodes?.[epIdx];
    if (!ep) return;

    await bot.safeEdit(chatId, messageId, `⏳ جاري جلب جودات <b>${views.escapeHtml(ep.title)}</b>...`);

    const provider = findProvider(details.candidate.site) || ALL_PROVIDERS[0];
    const epSources = await provider.getEpisodeSources(ep);

    const epKey = shortKey();
    await store.put(`mov_e:${epKey}`, JSON.stringify({ ep, epSources, itemKey, details, seasonIdx }), 3600);

    const text = views.formatEpisodeDetails(details.title, ep.title);
    const keyboard = kb.buildEpisodeQualitiesKeyboard(epKey, itemKey, epSources);

    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // Back to episodes: mov|be|{itemKey}|{seasonIdx}
  if (data.startsWith("mov|be|")) {
    const parts = data.split("|");
    const itemKey = parts[2];
    const seasonIdx = Number(parts[3]) || 0;
    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) return;
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    const season = details.seasons?.[seasonIdx] || details.seasons?.[0];
    const episodes = season?.episodes || [];
    const hasMultiple = (details.seasons?.length || 0) > 1;
    const text = views.formatSeriesDetails(details, season?.season);
    const keyboard = kb.buildSeriesEpisodesKeyboard(itemKey, stored.searchKey || "", episodes, seasonIdx, hasMultiple);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // Back to movie details: mov|d|{itemKey}
  if (data.startsWith("mov|d|")) {
    const [, , itemKey] = data.split("|");
    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) return;
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    const text = views.formatFilmDetails(details);
    const keyboard = kb.buildMovieDetailsKeyboard(itemKey, stored.searchKey || "", details.sources);
    await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    return;
  }

  // Save to archive: mov|ar|{itemKey}
  if (data.startsWith("mov|ar|")) {
    const [, , itemKey] = data.split("|");
    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) return;
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    await store.addToArchive({
      userId: String(cb.from?.id || chatId),
      title: details.title,
      kind: details.kind,
      url: details.candidate.url,
      site: details.candidate.site,
    });
    await bot.answerCallbackQuery(callbackId, "✅ تم الحفظ في أرشيفك الشخصي بنجاح!", true);
    return;
  }

  // Pick Movie Quality: mov|q|{itemKey}|{qIdx}
  if (data.startsWith("mov|q|")) {
    const [, , itemKey, qIdxStr] = data.split("|");
    const qIdx = Number(qIdxStr) || 0;
    const raw = await store.get(`mov_d:${itemKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد كتابة اسم العمل للبحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const details: MediaDetails = stored.details;
    const chosenSource = details.sources[qIdx];

    await bot.safeEdit(chatId, messageId, "⏳ جاري استخراج رابط التحميل والمشاهدة المباشر...");

    try {
      const provider = findProvider(details.candidate.site) || new AkwamProvider();
      const targetUrl = chosenSource?.url || details.candidate.url;
      const stream = await resolveBestDirectStream(
        provider,
        targetUrl,
        details.title,
        "movie",
      );

      const title = details.title;
      const quality = chosenSource?.quality || stream.quality || "720p HD";
      const size = chosenSource?.fileSize || stream.size;

      const watchUrl = await buildWatchPlayerUrl(env, stream.directVideoUrl, title);
      const streamKey = shortKey();
      await store.put(
        `mov_str:${streamKey}`,
        JSON.stringify({
          directVideoUrl: stream.directVideoUrl,
          watchUrl,
          title,
          quality,
          size,
          poster: details.poster,
        }),
        3600,
      );

      const text = views.formatStreamReadyCard(title, quality, size, false);
      const keyboard = kb.buildStreamReadyKeyboard(
        stream.directVideoUrl,
        streamKey,
        `mov|d|${itemKey}`,
        stored.searchKey || "",
        watchUrl,
      );

      await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    } catch (err: any) {
      await bot.safeEdit(
        chatId,
        messageId,
        `❌ تعذر استخراج الرابط المباشر:\n<code>${views.escapeHtml(err.message)}</code>`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 اختيار جودة أخرى", callback_data: `mov|d|${itemKey}` }]],
          },
        },
      );
    }
    return;
  }

  // Pick Episode Quality: mov|eq|{epKey}|{qIdx}
  if (data.startsWith("mov|eq|")) {
    const [, , epKey, qIdxStr] = data.split("|");
    const qIdx = Number(qIdxStr) || 0;
    const raw = await store.get(`mov_e:${epKey}`);
    if (!raw) {
      await bot.sendMessage(chatId, "⌛ انتهت الجلسة. أعد البحث.");
      return;
    }
    const stored = JSON.parse(raw);
    const epSources: SourceLink[] = stored.epSources;
    const chosenSource = epSources[qIdx];
    const details: MediaDetails = stored.details;
    const ep: Episode = stored.ep;

    await bot.safeEdit(chatId, messageId, "⏳ جاري استخراج رابط الحلقة المباشر...");

    try {
      const provider = findProvider(details.candidate.site) || new AkwamProvider();
      const targetUrl = chosenSource?.url || ep.url;
      const stream = await resolveBestDirectStream(
        provider,
        targetUrl,
        details.title,
        "series",
        ep.season || (stored.seasonIdx !== undefined ? stored.seasonIdx + 1 : 1),
        ep.episode,
      );

      const title = `${details.title} - ${ep.title}`;
      const quality = chosenSource?.quality || stream.quality || "720p HD";
      const size = chosenSource?.fileSize || stream.size;

      const watchUrl = await buildWatchPlayerUrl(env, stream.directVideoUrl, title);
      const streamKey = shortKey();
      await store.put(
        `mov_str:${streamKey}`,
        JSON.stringify({
          directVideoUrl: stream.directVideoUrl,
          watchUrl,
          title,
          quality,
          size,
          poster: details.poster,
        }),
        3600,
      );

      const text = views.formatStreamReadyCard(title, quality, size, true);
      const keyboard = kb.buildStreamReadyKeyboard(
        stream.directVideoUrl,
        streamKey,
        `mov|be|${stored.itemKey}|${stored.seasonIdx || 0}`,
        stored.searchKey || "",
        watchUrl,
      );

      await bot.safeEdit(chatId, messageId, text, { reply_markup: keyboard });
    } catch (err: any) {
      await bot.safeEdit(
        chatId,
        messageId,
        `❌ تعذر استخراج الرابط المباشر:\n<code>${views.escapeHtml(err.message)}</code>`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 رجوع للحلقات", callback_data: `mov|be|${stored.itemKey}|${stored.seasonIdx || 0}` }]],
          },
        },
      );
    }
    return;
  }

  // Send Video directly into Telegram chat: mov|send|{streamKey}
  if (data.startsWith("mov|send|")) {
    const [, , streamKey] = data.split("|");
    const raw = await store.get(`mov_str:${streamKey}`);
    if (!raw) {
      await bot.answerCallbackQuery(callbackId, "⌛ انتهت الجلسة. أعد اختيار الجودة.", true);
      return;
    }
    const item = JSON.parse(raw);
    await bot.answerCallbackQuery(callbackId, "⏳ جاري إرسال الفيديو للتليجرام...");

    const statusMsg = await bot.sendMessage(
      chatId,
      `⏳ <b>جاري إرسال الفيديو مباشرة داخل شات التليجرام...</b>\n🎬 <b>${views.escapeHtml(item.title)}</b>\n🎯 الجودة: <b>${item.quality}</b>\n<i>يرجى الانتظار بضع ثوانٍ بينما يقوم سيرفر التليجرام بالمعالجة...</i>`,
    );
    const statusMsgId = extractMsgId(statusMsg);

    const caption = `🎬 <b>${views.escapeHtml(item.title)}</b>\n🎯 الجودة: <b>${item.quality}</b>${item.size ? ` • 📦 ${item.size}` : ""}\n\n🍿 مشاهدة ممتعة عبر بوت فيلماتي!`;
    const videoKeyboard = {
      inline_keyboard: [
        [{ text: "⬇️ رابط التحميل المباشر (.mp4)", url: item.directVideoUrl }],
      ],
    };

    try {
      const res = await bot.sendVideo(chatId, item.directVideoUrl, caption, {
        reply_markup: videoKeyboard,
      });

      if (res && (res.ok || res.message_id)) {
        if (statusMsgId) await bot.deleteMessage(chatId, statusMsgId).catch(() => undefined);
        return;
      }
      throw new Error(res?.description || "Failed to send video directly");
    } catch (err: any) {
      if (statusMsgId) await bot.deleteMessage(chatId, statusMsgId).catch(() => undefined);
      const watchUrl = item.watchUrl || (await buildWatchPlayerUrl(env, item.directVideoUrl, item.title));
      await bot.sendMessage(
        chatId,
        `⚠️ <b>تنبيه من سيرفرات التليجرام:</b>
حجم الفيديو كبير (أكبر من 50MB) أو قيود سيرفر التليجرام تمنع استيراده تلقائياً في الشات.

👇 <b>يمكنك تحميله فوراً وبأقصى سرعة (.mp4) أو تشغيله مباشرة:</b>`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬇️ تحميل مباشر (.mp4)", url: item.directVideoUrl }],
              [{ text: "▶️ مشاهدة مباشرة أونلاين", url: watchUrl || item.directVideoUrl }],
            ],
          },
        },
      );
    }
    return;
  }
}
