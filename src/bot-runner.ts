/**
 * Standalone Node.js Bot Runner for Filmaty Bot
 * 
 * Runs Telegram Bot in Long Polling mode without Cloudflare limits:
 * - Unlimited execution time & CPU
 * - Unlimited subrequests for heavy scraping & multiple qualities
 * - Direct file downloading and streaming
 */

import { handleTelegramUpdate } from "./telegram/handlers.ts";
import type { Env } from "./env.ts";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}
const SIGNING_SECRET = process.env.SIGNING_SECRET || "filmaty-secret-key-2026-super-secure";
const OWNER_IDS = process.env.OWNER_IDS || "2092236677";
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const env: Env = {
  BOT_TOKEN,
  SIGNING_SECRET,
  OWNER_IDS,
  CACHE: undefined as any,
  DB: undefined as any,
};

async function callTg(method: string, body: Record<string, any> = {}): Promise<any> {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function startPolling() {
  console.log("==========================================");
  console.log("🎬 تشغيل بوت فيلماتي (Filmaty Bot Runner) بنظام Polling");
  console.log("⚡️ خالي تماماً من قيود كلاودفلير والـ Limits!");
  console.log("==========================================");

  // 1. Delete Webhook so getUpdates works
  console.log("🔄 جاري إزالة الـ Webhook لتفعيل استقبال التحديثات الفوري...");
  const delRes = await callTg("deleteWebhook", { drop_pending_updates: false });
  console.log("✅ حالة الويب هوك:", delRes.description || "Deleted");

  const me = await callTg("getMe");
  if (me.ok) {
    console.log(`🤖 متصل بنجاح: @${me.result.username} (${me.result.first_name})`);
  } else {
    console.error("❌ فشل الاتصال بتليجرام:", me.description);
    process.exit(1);
  }

  let offset = 0;
  let isRunning = true;

  process.on("SIGINT", () => {
    console.log("\n🛑 إيقاف البوت بأمان...");
    isRunning = false;
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    isRunning = false;
    process.exit(0);
  });

  console.log("🚀 البوت في وضع الاستماع الآن. جاهز لتلقي الطلبات!");

  while (isRunning) {
    try {
      const updatesRes = await callTg("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });

      if (!updatesRes.ok || !Array.isArray(updatesRes.result)) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      for (const update of updatesRes.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        const cb = update.callback_query;

        if (msg) {
          console.log(`[${new Date().toLocaleTimeString()}] 📩 رسالة من ${msg.from?.first_name || msg.chat?.id}: ${msg.text || "(وسائط)"}`);
        } else if (cb) {
          console.log(`[${new Date().toLocaleTimeString()}] 🔘 زر من ${cb.from?.first_name}: ${cb.data}`);
        }

        // Handle update asynchronously without blocking polling
        handleTelegramUpdate(update, env).catch((err) => {
          console.error("❌ خطأ أثناء معالجة التحديث:", err.message);
        });
      }
    } catch (err: any) {
      console.error("⚠️ خطأ في اتصال Polling (إعادة المحاولة بعد 3 ثوان):", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

startPolling();
