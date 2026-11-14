import type { Candidate, Episode, MediaDetails } from "../providers/types.ts";
import type { ProbeResult } from "../engine/probe.ts";
import type { ArchiveEntry } from "../engine/store.ts";

export function formatWelcome(): string {
  return `<b>مرحبًا بك في بوت فيلماتي 🎬🍿 (Filmaty Bot)</b>

محرك بحث وبث وسائط فائق السرعة، يجمع لك الأفلام والمسلسلات من أقوى السيرفرات العربية والعالمية مع الفحص المباشر للروابط قبل إرسالها!

<b>📌 الأوامر الأساسية:</b>
• <code>/film اسم الفيلم</code> - بحث مخصص عن الأفلام (مثال: <code>/film marvel</code>)
• <code>/series اسم المسلسل</code> - بحث عن المسلسلات مقسمة لمواسم وحلقات (مثال: <code>/series breaking bad</code>)
• يمكنك أيضًا إرسال اسم أي عمل مباشرة بدون أوامر!

<b>⚡️ المميزات الفائقة:</b>
✅ <b>فحص حي للروابط:</b> لا توجد روابط معطلة أو ميتة
✅ <b>تقسيم تلقائي:</b> مواسم ⬅️ حلقات ⬅️ جودات (1080p, 720p, 480p)
✅ <b>مشاهدة مباشرة:</b> مشغل فيديو سينمائي داخل التليجرام
✅ <b>تحميل مباشر:</b> روابط صاروخية مع عرض حجم الملف بدقة
✅ <b>أرشيف شخصي:</b> حفظ ومزامنة أعمالك وسجل المشاهدة

<i>اختر من القائمة أدناه للبدء:</i>`;
}

export function formatSearching(query: string, kind: string): string {
  const icon = kind === "series" ? "📺" : kind === "movie" ? "🎬" : "🔍";
  return `${icon} <b>جاري البحث عن:</b> <code>${escapeHtml(query)}</code>
⏳ يتم فحص السيرفرات والمصادر النشطة الآن...`;
}

export function formatSearchResults(query: string, count: number): string {
  return `🔍 <b>نتائج البحث عن:</b> <code>${escapeHtml(query)}</code>
تم العثور على <b>${count}</b> عمل. اختر العمل المطلوب لتحديد الجودة والمشاهدة:`;
}

export function formatNoResults(query: string): string {
  return `❌ <b>عذرًا، لم يتم العثور على نتائج لـ:</b> <code>${escapeHtml(query)}</code>

💡 <b>نصائح للبحث:</b>
• تأكد من كتابة الاسم بدون أخطاء إملائية.
• جرب البحث بالاسم الإنجليزي (مثال: <code>Batman</code> بدلاً من <code>باتمان</code>).
• جرب كلمة واحدة مميزة من العنوان.`;
}

export function formatFilmDetails(details: MediaDetails): string {
  const yearText = details.year ? ` • 📅 <b>سنة الإنتاج:</b> ${details.year}` : "";
  return `🎬 <b>${escapeHtml(details.title)}</b>${yearText}
🏷 <b>المصدر الأساسي:</b> ${details.candidate.siteLabel}
🛡 <b>حالة الروابط:</b> تم التحقق والفحص ✅

اختر <b>الجودة المناسبة</b> لاقتراح أفضل وأسرع سيرفر:`;
}

export function formatSeriesDetails(details: MediaDetails): string {
  const yearText = details.year ? ` • 📅 ${details.year}` : "";
  const seasonsCount = details.seasons.length;
  return `📺 <b>${escapeHtml(details.title)}</b>${yearText}
🏷 <b>المصدر:</b> ${details.candidate.siteLabel}
🗂 <b>عدد المواسم المتاحة:</b> ${seasonsCount} موسم

اختر <b>الموسم</b> لعرض الحلقات:`;
}

export function formatEpisodesList(title: string, seasonNum: number, count: number): string {
  return `📺 <b>${escapeHtml(title)}</b> - الموسم ${seasonNum}
يحتوي هذا الموسم على <b>${count}</b> حلقة.
اختر <b>الحلقة</b> لعرض الجودات والسيرفرات:`;
}

export function formatProbeRecommendation(
  title: string,
  quality: string,
  probe: ProbeResult,
  episode?: Episode,
): string {
  const epText = episode ? ` • الموسم ${episode.season} - الحلقة ${episode.episode}` : "";
  const sizeText = probe.sizeFormatted ? `\n📦 <b>حجم الملف:</b> <code>${probe.sizeFormatted}</code>` : "";
  const latencyText = `⚡️ <b>زمن الاستجابة:</b> <code>${probe.latencyMs}ms</code>`;

  return `🎬 <b>${escapeHtml(title)}</b>${epText}
🌟 <b>الجودة المختارة:</b> <code>${quality}</code>

🏆 <b>الخيار الأفضل والمقترح:</b>
${probe.serverTag} (${probe.host})
${latencyText}${sizeText}
🟢 <b>الحالة:</b> شغال 100% ومفحوص مسبقًا

جاهز للمشاهدة المباشرة والتحميل الفوري:`;
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

⏱ <b>وقت الاستجابة:</b> ممتاز (&lt; 250ms)
🛡 <b>نظام فحص الروابط (Health Probe):</b> فعال ومفعل`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
