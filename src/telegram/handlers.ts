import type { Env } from "../env.ts";
import { parseOwnerIds } from "../env.ts";
import { AppStore } from "../engine/store.ts";
import { fetchTmdbDetails, resolveBestDirectStream, tmdbTitleOf } from "../engine/resolve.ts";
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

// Convert a Telegram WebApp sendData payload {type, id, s, e} to the same
// short string form used by /start deep links. Returns null if invalid.
export function webAppDataToPayload(data: any): string | null {
  if (!data || typeof data !== "object") return null;
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
  const bot = new TelegramClient(env.BOT_TOKEN);
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
  // on it (best effort; the normal search flow runs regardless).
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
      }),
      3600,
    );
  }

  await bot.sendMessage(chatId, `⏳ جاري البحث عن: ${views.escapeHtml(tmdbTitle.title)}`);
  await executeSearch(
    chatId,
    tmdbTitle.originalTitle,
    payload.type === "tv" ? "series" : "movie",
    bot,
    store,
    env,
  );
}

async function executeSearch(
  chatId: number,
  query: string,
  kind: MediaKind | undefined,
  bot: TelegramClient,
  store: AppStore,
  _env: Env,
): Promise<void> {
  const statusMsg = await bot.sendMessage(chatId, views.formatSearching(query, kind || "all"));
  const statusId = extractMsgId(statusMsg);

  const results = await searchAllProviders(query, kind);

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

      const streamKey = shortKey();
      await store.put(
        `mov_str:${streamKey}`,
        JSON.stringify({
          directVideoUrl: stream.directVideoUrl,
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

      const streamKey = shortKey();
      await store.put(
        `mov_str:${streamKey}`,
        JSON.stringify({
          directVideoUrl: stream.directVideoUrl,
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
      await bot.sendMessage(
        chatId,
        `⚠️ <b>تنبيه من سيرفرات التليجرام:</b>
حجم الفيديو كبير (أكبر من 50MB) أو قيود سيرفر التليجرام تمنع استيراده تلقائياً في الشات.

👇 <b>يمكنك تحميله فوراً وبأقصى سرعة (.mp4) أو تشغيله مباشرة:</b>`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬇️ تحميل مباشر (.mp4)", url: item.directVideoUrl }],
              [{ text: "▶️ مشاهدة مباشرة أونلاين", url: item.directVideoUrl }],
            ],
          },
        },
      );
    }
    return;
  }
}
