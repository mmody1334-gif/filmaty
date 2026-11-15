export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

const ARABIC_DIACRITICS = /[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED]/g;

export function normalizeArabic(text: string): string {
  return toLatinDigits(text)
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ـ+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const NOISE_WORDS = new Set([
  "فيلم",
  "مسلسل",
  "الموسم",
  "موسم",
  "الحلقة",
  "الحلقه",
  "حلقة",
  "حلقه",
  "الاول",
  "الاولى",
  "الاولي",
  "الثاني",
  "الثانية",
  "الثالث",
  "الثالثة",
  "الرابع",
  "الرابعة",
  "الخامس",
  "الخامسة",
  "السادس",
  "السادسة",
  "السابع",
  "السابعة",
  "الثامن",
  "الثامنة",
  "التاسع",
  "التاسعة",
  "العاشر",
  "العاشرة",
  "انمي",
  "كرتون",
  "برنامج",
  "مشاهده",
  "مشاهدة",
  "تحميل",
  "تنزيل",
  "اون",
  "لاين",
  "اونلاين",
  "مترجم",
  "مترجمة",
  "مدبلج",
  "مدبلجة",
  "كامل",
  "كاملة",
  "حصريا",
  "حصري",
  "نسخة",
  "اصلية",
  "اصليه",
  "عائلي",
  "عائلية",
  "للكبار",
  "فقط",
  "بجودة",
  "جودة",
  "عالية",
  "دقة",
  "hd",
  "fhd",
  "uhd",
  "4k",
  "1080p",
  "720p",
  "480p",
  "bluray",
  "web-dl",
  "webrip",
  "cam",
  "hdtv",
]);

export function cleanTitle(raw: string): string {
  const normalized = toLatinDigits(raw)
    .replace(/[\[\]\(\)\{\}\-_+:]/g, " ")
    .replace(ARABIC_DIACRITICS, "");

  // Remove S01E01 or standalone episode numbers right after episode tag
  const withoutEpNumbers = normalized
    .replace(/\bs\d{1,2}\s*e\d{1,3}\b/gi, " ")
    .replace(/(?:الحلق[هة]|الموسم)\s+\d{1,3}/gi, " ");

  const words = withoutEpNumbers.split(/\s+/);
  const kept: string[] = [];

  for (const w of words) {
    const cleanWord = w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!cleanWord) continue;
    if (NOISE_WORDS.has(cleanWord)) continue;
    kept.push(w);
  }

  return kept.join(" ").replace(/\s+/g, " ").trim();
}

const ARABIC_NUM_WORDS: Record<string, number> = {
  الاول: 1,
  الاولى: 1,
  الاولي: 1,
  الثاني: 2,
  الثانية: 2,
  الثالث: 3,
  الثالثة: 3,
  الرابع: 4,
  الرابعة: 4,
  الخامس: 5,
  الخامسة: 5,
  السادس: 6,
  السادسة: 6,
  السابع: 7,
  السابعة: 7,
  الثامن: 8,
  الثامنة: 8,
  التاسع: 9,
  التاسعة: 9,
  العاشر: 10,
  العاشرة: 10,
  "الحادي عشر": 11,
  "الثاني عشر": 12,
  "الثالث عشر": 13,
  "الرابع عشر": 14,
  "الخامس عشر": 15,
  "السادس عشر": 16,
  "السابع عشر": 17,
  "الثامن عشر": 18,
  "التاسع عشر": 19,
  العشرون: 20,
  "الحادية والعشرون": 21,
  "الثانية والعشرون": 22,
  "الثلاثون": 30,
};

export function parseSeasonEpisode(text: string): { season?: number; episode?: number } {
  const norm = normalizeArabic(text);
  let season: number | undefined;
  let episode: number | undefined;

  // Patterns like S01E05 or S1 E5
  const seMatch = norm.match(/\bs(\d{1,2})\s*e(\d{1,3})\b/i);
  if (seMatch) {
    return { season: Number(seMatch[1]), episode: Number(seMatch[2]) };
  }

  // Season number pattern (e.g., الموسم 2, الموسم الثاني)
  const sNumMatch = norm.match(/الموسم\s+(\d{1,2})/);
  if (sNumMatch) {
    season = Number(sNumMatch[1]);
  } else {
    for (const [word, val] of Object.entries(ARABIC_NUM_WORDS)) {
      if (norm.includes(`الموسم ${word}`)) {
        season = val;
        break;
      }
    }
  }

  // Episode number pattern (e.g., الحلقة 13, الحلقة الثالثة)
  const epNumMatch = norm.match(/الحلق[هة]\s+(\d{1,3})/);
  if (epNumMatch) {
    episode = Number(epNumMatch[1]);
  } else {
    for (const [word, val] of Object.entries(ARABIC_NUM_WORDS)) {
      if (norm.includes(`الحلقه ${word}`) || norm.includes(`الحلقة ${word}`)) {
        episode = val;
        break;
      }
    }
  }

  return { season, episode };
}

export function parseYear(text: string): number | undefined {
  const matches = toLatinDigits(text).match(/\b(19\d{2}|20\d{2})\b/g);
  if (!matches) return undefined;
  const currentYear = new Date().getFullYear();
  for (let i = matches.length - 1; i >= 0; i--) {
    const y = Number(matches[i]);
    if (y >= 1940 && y <= currentYear + 2) return y;
  }
  return undefined;
}

export function parseQuality(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("4k") || lower.includes("2160p") || lower.includes("uhd")) return "4K";
  if (lower.includes("1080p") || lower.includes("fhd")) return "1080p";
  if (lower.includes("720p") || lower.includes("hd")) return "720p";
  if (lower.includes("480p") || lower.includes("sd")) return "480p";
  if (lower.includes("360p")) return "360p";
  return "HD";
}

export function computeSimilarity(query: string, candidate: string): number {
  const qNorm = normalizeArabic(cleanTitle(query));
  const cNorm = normalizeArabic(cleanTitle(candidate));

  if (!qNorm || !cNorm) return 0;
  if (qNorm === cNorm) return 1.0;
  if (cNorm.includes(qNorm)) return 0.9;

  const qWords = qNorm.split(" ").filter((w) => w.length > 1);
  const cWords = new Set(cNorm.split(" ").filter((w) => w.length > 1));

  if (qWords.length === 0 || cWords.size === 0) return 0;

  let matchedWords = 0;
  for (const qw of qWords) {
    if (cWords.has(qw)) {
      matchedWords++;
      continue;
    }
    for (const cw of cWords) {
      if (cw.includes(qw) || qw.includes(cw)) {
        matchedWords += 0.8;
        break;
      }
    }
  }

  const wordScore = matchedWords / qWords.length;
  const qGrams = getBigrams(qNorm);
  const cGrams = getBigrams(cNorm);
  let overlap = 0;
  for (const g of qGrams) {
    if (cGrams.has(g)) overlap++;
  }
  const bigramScore = (2 * overlap) / (qGrams.size + cGrams.size || 1);

  return Math.max(wordScore, bigramScore * 0.9);
}

function getBigrams(str: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    set.add(str.slice(i, i + 2));
  }
  return set;
}

export function hostOf(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

export function isRelevant(title: string, query: string): boolean {
  const tNorm = normalizeArabic(cleanTitle(title));
  const qNorm = normalizeArabic(cleanTitle(query));

  if (!tNorm || !qNorm) return false;
  if (tNorm.includes(qNorm) || qNorm.includes(tNorm)) return true;

  const qTokens = qNorm.split(/[\s:\-_]+/).filter((w) => w.length >= 2);
  if (qTokens.length === 0) return true;

  let matches = 0;
  for (const token of qTokens) {
    if (tNorm.includes(token)) {
      matches++;
    }
  }

  if (matches > 0) return true;

  return computeSimilarity(query, title) >= 0.45;
}
