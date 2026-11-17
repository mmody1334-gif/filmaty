import type { Candidate, Episode, MediaDetails } from "../providers/types.ts";
import type { ProbeResult } from "../engine/probe.ts";
import type { ArchiveEntry } from "../engine/store.ts";

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatWelcome(): string {
  return `<b>مرحبًا بك في بوت فيلماتي 🎬🍿 (Filmaty Bot)</b>

محرك بحث وتحميل وسائط متكامل وسريع:
• أفلام ومسلسلات بروابط تحميل ومشاهدة مباشرة فائقة السرعة
• تحميل فيديوهات TikTok بدون علامة مائية
• تحميل ريلز وبوستات Instagram
• تحميل فيديوهات وبلاي ليستات YouTube الفردية والكاملة

<b>📌 الأوامر الأساسية:</b>
• <code>/app</code> - فتح تطبيق فيلماتي (الويب آب) مباشرة
• <code>/film اسم الفيلم</code> - بحث مخصص عن الأفلام (مثال: <code>/film marvel</code>)
• <code>/series اسم المسلسل</code> - بحث عن المسلسلات مقسمة لمواسم وحلقات
• يمكنك أيضاً إرسال اسم أي عمل مباشرة بدون أوامر!
• أو الصق رابط فيديو من TikTok أو Instagram أو YouTube ليتم تحميله فوراً!

<b>⚡️ المميزات:</b>
✅ <b>تحميل مباشر وفوري:</b> روابط CDN سريعة وتدعم برامج التحميل مثل IDM
✅ <b>تقسيم تلقائي:</b> مواسم ⬅️ حلقات ⬅️ جودات (1080p, 720p, 480p)
✅ <b>مشاهدة مباشرة:</b> تشغيل الفيديو داخل التليجرام والمتصفح
✅ <b>أرشيف شخصي:</b> <code>/archive</code> لحفظ أعمالك المفضلة

<i>اختر من القائمة أدناه للبدء:</i>`;
}

export function formatAppMessage(): string {
  return `<b>🎬 تطبيق فيلماتي</b>

🌐 <code>https://mmody1334-gif.github.io/filmaty/</code>

افتح التطبيق من الزرار اللي تحت — بيشتغل جوه التليجرام. وتقدر كمان تثبّته على موبايلك: افتح الرابط من المتصفح ← «أضف للشاشة الرئيسية».

📺 وضع التلفزيون: <code>https://mmody1334-gif.github.io/filmaty/Tv/</code>`;
}

export function formatSearching(query: string, kind: string): string {
  const icon = kind === "series" ? "📺" : kind === "movie" ? "🎬" : "🔍";
  return `${icon} <b>جاري البحث عن:</b> <code>${escapeHtml(query)}</code>
⏳ يتم البحث في أقوى السيرفرات والمصادر الآن...`;
}

export function formatSearchResults(query: string, count: number): string {
  return `🔍 <b>نتائج البحث عن:</b> <code>${escapeHtml(query)}</code>
تم العثور على <b>${count}</b> عمل. اختر العمل المطلوب لعرض التفاصيل والجودات:`;
}

export function formatNoResults(query: string): string {
  return `❌ <b>عذرًا، لم يتم العثور على نتائج لـ:</b> <code>${escapeHtml(query)}</code>

💡 <b>نصائح للبحث:</b>
• تأكد من كتابة الاسم بدون أخطاء إملائية.
• جرب البحث بالاسم الإنجليزي (مثال: <code>Endgame</code> أو <code>Batman</code>).
• جرب كلمة واحدة مميزة من العنوان.`;
}

export function formatFilmDetails(details: MediaDetails): string {
  const yearText = details.year ? ` • 📅 ${details.year}` : "";
  const ratingText = details.rating ? ` • ⭐ ${details.rating}` : "";
  const story = details.description ? `\n\n📖 <b>القصة:</b>\n${escapeHtml(details.description.slice(0, 450))}` : "";

  return `🎬 <b>${escapeHtml(details.title)}</b>${yearText}${ratingText}${story}

👇 <b>اختر الجودة للتحميل أو المشاهدة:</b>`;
}

export function formatSeriesSeasons(details: MediaDetails): string {
  const yearText = details.year ? ` • 📅 ${details.year}` : "";
  const ratingText = details.rating ? ` • ⭐ ${details.rating}` : "";
  const story = details.description ? `\n\n📖 <b>القصة:</b>\n${escapeHtml(details.description.slice(0, 450))}` : "";

  return `📺 <b>${escapeHtml(details.title)}</b>${yearText}${ratingText}${story}

👇 <b>اختر الموسم المطلوب:</b>`;
}

export function formatSeriesDetails(details: MediaDetails, seasonNum?: number): string {
  const yearText = details.year ? ` • 📅 ${details.year}` : "";
  const ratingText = details.rating ? ` • ⭐ ${details.rating}` : "";
  const seasonBadge = seasonNum ? ` • 📺 الموسم ${seasonNum}` : "";
  const story = details.description ? `\n\n📖 <b>القصة:</b>\n${escapeHtml(details.description.slice(0, 450))}` : "";

  return `📺 <b>${escapeHtml(details.title)}</b>${seasonBadge}${yearText}${ratingText}${story}

👇 <b>اختر الحلقة:</b>`;
}

export function formatEpisodeDetails(seriesTitle: string, epTitle: string): string {
  return `📺 <b>${escapeHtml(seriesTitle)}</b>
▶️ <b>${escapeHtml(epTitle)}</b>

👇 <b>اختر الجودة المطلوبة:</b>`;
}

/**
 * Stream ready card with clear two-choice download/watch actions
 */
export function formatStreamReadyCard(
  title: string,
  quality: string,
  size?: string,
  isSeries = false,
): string {
  const icon = isSeries ? "📺" : "🎬";
  const sizeText = size ? size : "N/A";

  return `✅ <b>Ready to stream and download! | جاهز للتشغيل والتحميل!</b>
${icon} <b>${escapeHtml(title)}</b>
🎯 <b>الجودة (Quality):</b> ${quality}
📦 <b>الحجم (Size):</b> ${sizeText}

👇 <b>اختر الإجراء المناسب لك:</b>
• اضغط <b>تحميل مباشر</b> لتنزيل ملف الفيديو فوراً (.mp4).
• اضغط <b>إرسال في التليجرام</b> ليصلك الفيديو كملف تشغيلي داخل المحادثة.`;
}

export function formatArchive(items: ArchiveEntry[]): string {
  if (items.length === 0) {
    return `📁 <b>أرشيفك وسجل المشاهدة فارغ حاليًا.</b>\nابدأ بالبحث عن فيلم أو مسلسل وحفظه في أرشيفك!`;
  }

  let text = `📁 <b>أرشيفك الشخصي وسجل المشاهدة (${items.length}):</b>\n\n`;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const kindBadge = item.kind === "series" ? "📺" : "🎬";
    const epBadge = item.season && item.episode ? ` [م${item.season} ح${item.episode}]` : "";
    const qBadge = item.quality ? ` (${item.quality})` : "";
    text += `${i + 1}. ${kindBadge} <b>${escapeHtml(item.title)}</b>${epBadge}${qBadge}\n`;
  }
  return text;
}

export function formatStatus(activeSites: string[]): string {
  return `⚡️ <b>حالة خوادم ومصادر بوت فيلماتي:</b>

🟢 <b>المصادر النشطة والمتصلة:</b>
${activeSites.map((s) => `• ✅ ${s}`).join("\n")}

⏱ <b>وقت الاستجابة:</b> ممتاز (&lt; 200ms)
🛡 <b>نظام التحميل المباشر:</b> فعال وجاهز 100%`;
}
