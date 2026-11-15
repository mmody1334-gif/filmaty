import type { Candidate, Episode, SeasonGroup, SourceLink } from "../providers/types.ts";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "./client.ts";

export function buildMainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎬 بحث عن فيلم (/film)", callback_data: "cmd:film" },
        { text: "📺 بحث عن مسلسل (/series)", callback_data: "cmd:series" },
      ],
      [
        { text: "📁 أرشيفي وسجل المشاهدة", callback_data: "cmd:archive" },
        { text: "⚡️ حالة السيرفرات والمصادر", callback_data: "cmd:status" },
      ],
    ],
  };
}

export function buildSearchResultsKeyboard(
  candidates: Candidate[],
  searchKey: string,
  page = 0,
  pageSize = 6,
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  const start = page * pageSize;
  const pageItems = candidates.slice(start, start + pageSize);

  for (let i = 0; i < pageItems.length; i++) {
    const cand = pageItems[i];
    const idx = start + i;
    const kindBadge = cand.kind === "series" ? "📺" : "🎬";
    const yearBadge = cand.year ? ` (${cand.year})` : "";
    const siteBadge = cand.siteLabel ? ` [${cand.siteLabel}]` : "";

    keyboard.push([
      {
        text: `${kindBadge} ${cand.title}${yearBadge}${siteBadge}`,
        callback_data: `mov|s|${searchKey}|${idx}`,
      },
    ]);
  }

  // Pagination row
  const navRow: InlineKeyboardButton[] = [];
  if (page > 0) {
    navRow.push({ text: "⬅️ السابق", callback_data: `mov|p|${searchKey}|${page - 1}` });
  }
  if (start + pageSize < candidates.length) {
    navRow.push({ text: "التالي ➡️", callback_data: `mov|p|${searchKey}|${page + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: "🔍 بحث جديد", callback_data: "nav:search" }]);
  return { inline_keyboard: keyboard };
}

export function buildMovieDetailsKeyboard(
  itemKey: string,
  searchKey: string,
  sources: SourceLink[],
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const sizeStr = s.fileSize ? ` (${s.fileSize})` : "";
    keyboard.push([
      {
        text: `📥 ${s.quality}${sizeStr}`,
        callback_data: `mov|q|${itemKey}|${i}`,
      },
    ]);
  }

  // Fallback qualities if sources empty
  if (sources.length === 0) {
    keyboard.push([
      { text: "🌟 1080p FHD", callback_data: `mov|q|${itemKey}|0` },
      { text: "⚡️ 720p HD", callback_data: `mov|q|${itemKey}|1` },
      { text: "📱 480p SD", callback_data: `mov|q|${itemKey}|2` },
    ]);
  }

  const backRow: InlineKeyboardButton[] = [];
  if (searchKey) {
    backRow.push({ text: "🔙 رجوع للبحث", callback_data: `mov|b|${searchKey}` });
  }
  backRow.push({ text: "💾 حفظ بالأرشيف", callback_data: `mov|ar|${itemKey}` });
  keyboard.push(backRow);

  return { inline_keyboard: keyboard };
}

export function buildSeriesSeasonsKeyboard(
  itemKey: string,
  searchKey: string,
  seasons: SeasonGroup[],
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  let currentRow: InlineKeyboardButton[] = [];

  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    currentRow.push({
      text: `📺 الموسم ${s.season}`,
      callback_data: `mov|sn|${itemKey}|${i}`,
    });

    if (currentRow.length === 3) {
      keyboard.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) {
    keyboard.push(currentRow);
  }

  const backRow: InlineKeyboardButton[] = [];
  if (searchKey) {
    backRow.push({ text: "🔙 رجوع للبحث", callback_data: `mov|b|${searchKey}` });
  }
  backRow.push({ text: "💾 حفظ بالأرشيف", callback_data: `mov|ar|${itemKey}` });
  keyboard.push(backRow);

  return { inline_keyboard: keyboard };
}

export function buildSeriesEpisodesKeyboard(
  itemKey: string,
  searchKey: string,
  episodes: Episode[],
  seasonIdx = 0,
  hasMultipleSeasons = false,
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  let currentRow: InlineKeyboardButton[] = [];

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    currentRow.push({
      text: `حلقة ${ep.episode}`,
      callback_data: `mov|e|${itemKey}|${seasonIdx}|${i}`,
    });

    if (currentRow.length === 4) {
      keyboard.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) {
    keyboard.push(currentRow);
  }

  const backRow: InlineKeyboardButton[] = [];
  if (hasMultipleSeasons) {
    backRow.push({ text: "🔙 اختيار موسم آخر", callback_data: `mov|sns|${itemKey}` });
  }
  if (searchKey) {
    backRow.push({ text: "🔙 رجوع للبحث", callback_data: `mov|b|${searchKey}` });
  }
  backRow.push({ text: "💾 حفظ بالأرشيف", callback_data: `mov|ar|${itemKey}` });
  keyboard.push(backRow);

  return { inline_keyboard: keyboard };
}

export function buildEpisodeQualitiesKeyboard(
  epKey: string,
  itemKey: string,
  sources: SourceLink[],
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const sizeStr = s.fileSize ? ` (${s.fileSize})` : "";
    keyboard.push([
      {
        text: `📥 ${s.quality}${sizeStr}`,
        callback_data: `mov|eq|${epKey}|${i}`,
      },
    ]);
  }

  if (sources.length === 0) {
    keyboard.push([
      { text: "🌟 1080p FHD", callback_data: `mov|eq|${epKey}|0` },
      { text: "⚡️ 720p HD", callback_data: `mov|eq|${epKey}|1` },
      { text: "📱 480p SD", callback_data: `mov|eq|${epKey}|2` },
    ]);
  }

  keyboard.push([{ text: "🔙 رجوع للحلقات", callback_data: `mov|be|${itemKey}` }]);
  return { inline_keyboard: keyboard };
}

/**
 * Exact layout from user Image 3:
 * ⬇️ Fast Direct Download
 * ▶️ Direct Stream
 * 🔙 Other Quality | 🔍 Back to Search
 */
export function buildStreamReadyKeyboard(
  directVideoUrl: string,
  backQualityCallback: string,
  searchKey: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "⬇️ Fast Direct Download", url: directVideoUrl }],
      [{ text: "▶️ Direct Stream", url: directVideoUrl }],
      [
        { text: "🔙 Other Quality", callback_data: backQualityCallback },
        { text: "🔍 Back to Search", callback_data: `mov|b|${searchKey}` },
      ],
    ],
  };
}

export function buildTikTokKeyboard(
  videoUrl?: string,
  audioUrl?: string,
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  if (videoUrl) {
    keyboard.push([{ text: "⬇️ تحميل فيديو HD بدون علامة مائية", url: videoUrl }]);
  }
  if (audioUrl) {
    keyboard.push([{ text: "🎵 تحميل الصوت فقط (MP3)", url: audioUrl }]);
  }
  return { inline_keyboard: keyboard };
}

export function buildInstagramKeyboard(mediaUrl?: string): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  if (mediaUrl) {
    keyboard.push([{ text: "⬇️ تحميل المحتوى مباشرة", url: mediaUrl }]);
  }
  return { inline_keyboard: keyboard };
}

export function buildYouTubeFormatKeyboard(key: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "📹 فيديو (Video)", callback_data: `ytf|${key}|video` },
        { text: "🎵 صوت (Audio)", callback_data: `ytf|${key}|audio` },
      ],
    ],
  };
}

export function buildYouTubeQualityKeyboard(key: string, isAudio: boolean): InlineKeyboardMarkup {
  if (isAudio) {
    return {
      inline_keyboard: [
        [
          { text: "💎 320 kbps (عالية جداً)", callback_data: `ytq|${key}|320` },
          { text: "🎧 128 kbps (قياسية)", callback_data: `ytq|${key}|128` },
        ],
        [{ text: "🔙 رجوع", callback_data: `ytb|${key}` }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        { text: "🌟 1080p FHD", callback_data: `ytq|${key}|1080` },
        { text: "🎬 720p HD", callback_data: `ytq|${key}|720` },
      ],
      [
        { text: "📺 480p SD", callback_data: `ytq|${key}|480` },
        { text: "📱 360p", callback_data: `ytq|${key}|360` },
      ],
      [{ text: "🔙 رجوع", callback_data: `ytb|${key}` }],
    ],
  };
}

export function buildYouTubePlaylistKeyboard(
  key: string,
  page = 0,
  pageSize = 5,
  totalItems = 0,
  items: Array<{ title: string; index: number }> = [],
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  const start = page * pageSize;
  const pageSlice = items.slice(start, start + pageSize);

  for (let i = 0; i < pageSlice.length; i++) {
    const item = pageSlice[i];
    const realIdx = start + i;
    keyboard.push([
      {
        text: `▶️ ${item.index}. ${item.title.slice(0, 40)}`,
        callback_data: `ytpls|${key}|${realIdx}`,
      },
    ]);
  }

  const navRow: InlineKeyboardButton[] = [];
  if (page > 0) {
    navRow.push({ text: "⬅️ السابق", callback_data: `ytplp|${key}|${page - 1}` });
  }
  if (start + pageSize < totalItems) {
    navRow.push({ text: "التالي ➡️", callback_data: `ytplp|${key}|${page + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  return { inline_keyboard: keyboard };
}
