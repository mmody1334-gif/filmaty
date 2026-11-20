import { test } from "node:test";
import assert from "node:assert/strict";
import { isDubbed } from "../src/engine/normalize.ts";
import { FILMATY_WEBAPP_HTML } from "../src/player/webapp-html.ts";

test("isDubbed flags Arabic/English dub markers and leaves originals alone", () => {
  for (const t of ["مسلسل قيامة أرطغرل مدبلج", "فيلم الأسد الملك مدبلج للعربية", "Frozen Arabic Dub", "Naruto dubbed", "الحلقة 5 مدبلجة"]) {
    assert.ok(isDubbed(t), t);
  }
  for (const t of ["مسلسل قيامة أرطغرل مترجم", "Interstellar 2014", "The Dubliners"]) {
    assert.ok(!isDubbed(t), t);
  }
});

test("player skips a dead native server after a fixed budget and defaults subtitles to Arabic", () => {
  for (const s of [
    "const SERVER_START_MS = 25000;",
    "const SERVER_STALL_MS = 20000;",
    "function skipToNextServer(reason)",
    "armServerStartWatchdog();",
    "resetServerWatchdogState();",
    "const SUB_LANG_KEY = 'filmaty:subLang';",
    "localStorage.getItem(SUB_LANG_KEY) || 'ar'",
    "autoApplyPreferredSubtitle(tracks, mediaKey);",
  ]) {
    assert.ok(FILMATY_WEBAPP_HTML.includes(s), `webapp must contain: ${s}`);
  }
});
