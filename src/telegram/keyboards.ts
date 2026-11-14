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
    const siteBadge = `[${cand.siteLabel}]`;

    keyboard.push([
      {
        text: `${kindBadge} ${cand.title}${yearBadge} ${siteBadge}`,
        callback_data: `sr:${idx}`,
      },
    ]);
  }

  // Pagination buttons
  const navRow: InlineKeyboardButton[] = [];
  if (page > 0) {
    navRow.push({ text: "⬅️ السابق", callback_data: `pg:${page - 1}` });
  }
  if (start + pageSize < candidates.length) {
    navRow.push({ text: "التالي ➡️", callback_data: `pg:${page + 1}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([{ text: "🔍 بحث جديد", callback_data: "nav:search" }]);

  return { inline_keyboard: keyboard };
}

export function buildSeasonsKeyboard(seasons: SeasonGroup[]): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  const row: InlineKeyboardButton[] = [];

  for (const s of seasons) {
    row.push({
      text: `الموسم ${s.season} (${s.episodes.length} حلقة)`,
      callback_data: `sn:${s.season}`,
    });
    if (row.length === 2) {
      keyboard.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) {
    keyboard.push(row);
  }

  keyboard.push([{ text: "↩️ رجوع للنتائج", callback_data: "nav:results" }]);
  return { inline_keyboard: keyboard };
}

export function buildEpisodesKeyboard(seasonNum: number, episodes: Episode[]): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];
  let row: InlineKeyboardButton[] = [];

  for (const ep of episodes) {
    row.push({
      text: `حلقة ${ep.episode}`,
      callback_data: `ep:${seasonNum}:${ep.episode}`,
    });
    if (row.length === 4) {
      keyboard.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) {
    keyboard.push(row);
  }

  keyboard.push([
    { text: "↩️ اختيار موسم آخر", callback_data: "nav:seasons" },
    { text: "🏠 القائمة الرئيسية", callback_data: "nav:menu" },
  ]);
  return { inline_keyboard: keyboard };
}

export function buildQualitiesKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🌟 1080p FHD (فائق الدقة)", callback_data: "ql:1080p" },
        { text: "⚡️ 720p HD (الأسرع والأفضل)", callback_data: "ql:720p" },
      ],
      [
        { text: "📱 480p SD (توفير البيانات)", callback_data: "ql:480p" },
        { text: "📺 كل السيرفرات المتاحة", callback_data: "ql:all" },
      ],
      [{ text: "↩️ رجوع", callback_data: "nav:back" }],
    ],
  };
}

export function buildPlayOptionsKeyboard(
  playerUrl: string,
  downloadUrl?: string,
  extraServers: SourceLink[] = [],
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];

  // Main direct action buttons
  keyboard.push([
    {
      text: "🎬 مشاهدة مباشرة الآن",
      web_app: { url: playerUrl },
    },
  ]);

  if (downloadUrl) {
    keyboard.push([
      {
        text: "📥 تحميل مباشر فائق السرعة",
        url: downloadUrl,
      },
    ]);
  }

  // If there are mirror servers (e.g., StreamWish, Mixdrop, VK, Uqload)
  if (extraServers.length > 0) {
    for (let i = 0; i < Math.min(extraServers.length, 4); i++) {
      const s = extraServers[i];
      keyboard.push([
        {
          text: `🗂 ${s.name}`,
          url: s.url,
        },
      ]);
    }
  }

  keyboard.push([
    { text: "💾 حفظ في أرشيفي الشخصي", callback_data: "ar:save" },
    { text: "🔍 بحث جديد", callback_data: "nav:search" },
  ]);

  return { inline_keyboard: keyboard };
}
