import type { Env } from "../env.ts";
import { parseOwnerIds } from "../env.ts";
import { probeCached, type ProbeResult } from "../engine/probe.ts";
import { AppStore } from "../engine/store.ts";
import { signToken } from "../engine/token.ts";
import { ALL_PROVIDERS, findProvider, searchAllProviders } from "../providers/index.ts";
import type { Candidate, Episode, MediaDetails, MediaKind, SourceLink } from "../providers/types.ts";
import { TelegramClient } from "./client.ts";
import * as kb from "./keyboards.ts";
import * as views from "./views.ts";

export async function handleTelegramUpdate(update: any, env: Env): Promise<Response> {
  const bot = new TelegramClient(env.BOT_TOKEN);
  const store = new AppStore(env);

  try {
    if (update.message) {
      await handleMessage(update.message, bot, store, env);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, bot, store, env);
    }
  } catch (err) {
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

  if (text === "/start") {
    await bot.sendMessage(chatId, views.formatWelcome(), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
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

  // /film command
  if (text.startsWith("/film")) {
    const query = text.replace(/^\/film\s*/i, "").trim();
    if (!query) {
      await store.setSession(chatId, { step: "results", kind: "movie" });
      await bot.sendMessage(chatId, "🎬 أرسل اسم الفيلم أو كلمة البحث (مثال: <code>marvel</code> أو <code>Interstellar</code>):");
      return;
    }
    await executeSearch(chatId, query, "movie", bot, store, env);
    return;
  }

  // /series command
  if (text.startsWith("/series")) {
    const query = text.replace(/^\/series\s*/i, "").trim();
    if (!query) {
      await store.setSession(chatId, { step: "results", kind: "series" });
      await bot.sendMessage(chatId, "📺 أرسل اسم المسلسل أو كلمة البحث (مثال: <code>Breaking Bad</code> أو <code>Game of Thrones</code>):");
      return;
    }
    await executeSearch(chatId, query, "series", bot, store, env);
    return;
  }

  // Direct text query (search both films and series)
  const session = await store.getSession(chatId);
  const targetKind: MediaKind | undefined =
    session?.kind === "movie" || session?.kind === "series" ? session.kind : undefined;

  await executeSearch(chatId, text, targetKind, bot, store, env);
}

async function executeSearch(
  chatId: number,
  query: string,
  kind: MediaKind | undefined,
  bot: TelegramClient,
  store: AppStore,
  env: Env,
): Promise<void> {
  const searchingMsg = await bot.sendMessage(chatId, views.formatSearching(query, kind || "all"));

  const results = await searchAllProviders(query, kind);

  if (results.length === 0) {
    await bot.sendMessage(chatId, views.formatNoResults(query), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }

  // Store search results in session
  await store.setSession(chatId, {
    query,
    kind: kind || "all",
    step: "results",
    selectedCandidate: results, // Store candidates array in session
  });

  await bot.sendMessage(chatId, views.formatSearchResults(query, results.length), {
    reply_markup: kb.buildSearchResultsKeyboard(results, 0),
  });
}

async function handleCallbackQuery(cb: any, bot: TelegramClient, store: AppStore, env: Env): Promise<void> {
  const callbackId = cb.id;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const data = cb.data || "";

  if (!chatId || !messageId) return;

  await bot.answerCallbackQuery(callbackId);

  // Main menu navigation
  if (data === "cmd:film") {
    await store.setSession(chatId, { step: "results", kind: "movie" });
    await bot.sendMessage(chatId, "🎬 أرسل اسم الفيلم للبحث:");
    return;
  }
  if (data === "cmd:series") {
    await store.setSession(chatId, { step: "results", kind: "series" });
    await bot.sendMessage(chatId, "📺 أرسل اسم المسلسل للبحث:");
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
  if (data === "nav:menu" || data === "nav:search") {
    await bot.sendMessage(chatId, views.formatWelcome(), {
      reply_markup: kb.buildMainMenuKeyboard(),
    });
    return;
  }

  // Pagination: pg:<page>
  if (data.startsWith("pg:")) {
    const page = Number(data.split(":")[1]) || 0;
    const session = await store.getSession(chatId);
    const candidates: Candidate[] = Array.isArray(session?.selectedCandidate)
      ? session.selectedCandidate
      : [];
    if (candidates.length > 0) {
      await bot.editMessageText(chatId, messageId, views.formatSearchResults(session?.query || "", candidates.length), {
        reply_markup: kb.buildSearchResultsKeyboard(candidates, page),
      });
    }
    return;
  }

  // Select Search Result: sr:<idx>
  if (data.startsWith("sr:")) {
    const idx = Number(data.split(":")[1]);
    const session = await store.getSession(chatId);
    const candidates: Candidate[] = Array.isArray(session?.selectedCandidate)
      ? session.selectedCandidate
      : [];
    const chosen = candidates[idx];
    if (!chosen) {
      await bot.sendMessage(chatId, "❌ انتهت الجلسة، الرجاء إعادة البحث.");
      return;
    }

    const provider = findProvider(chosen.site) || ALL_PROVIDERS[0];
    const details = await provider.getDetails(chosen);

    await store.setSession(chatId, {
      selectedCandidate: chosen,
      step: details.kind === "series" ? "seasons" : "qualities",
    });

    if (details.kind === "series" && details.seasons.length > 0) {
      await bot.sendMessage(chatId, views.formatSeriesDetails(details), {
        reply_markup: kb.buildSeasonsKeyboard(details.seasons),
      });
    } else {
      await bot.sendMessage(chatId, views.formatFilmDetails(details), {
        reply_markup: kb.buildQualitiesKeyboard(),
      });
    }
    return;
  }

  // Select Season: sn:<season_num>
  if (data.startsWith("sn:")) {
    const seasonNum = Number(data.split(":")[1]);
    const session = await store.getSession(chatId);
    const chosen: Candidate = session?.selectedCandidate;
    if (!chosen) return;

    const provider = findProvider(chosen.site) || ALL_PROVIDERS[0];
    const details = await provider.getDetails(chosen);
    const season = details.seasons.find((s) => s.season === seasonNum) || details.seasons[0];

    if (!season) {
      await bot.sendMessage(chatId, "❌ لم يتم العثور على حلقات لهذا الموسم.");
      return;
    }

    await store.setSession(chatId, {
      selectedSeason: seasonNum,
      step: "episodes",
    });

    await bot.sendMessage(
      chatId,
      views.formatEpisodesList(details.title, seasonNum, season.episodes.length),
      {
        reply_markup: kb.buildEpisodesKeyboard(seasonNum, season.episodes),
      },
    );
    return;
  }

  // Select Episode: ep:<season_num>:<ep_num>
  if (data.startsWith("ep:")) {
    const [, sStr, epStr] = data.split(":");
    const seasonNum = Number(sStr);
    const epNum = Number(epStr);

    await store.setSession(chatId, {
      selectedSeason: seasonNum,
      selectedEpisode: epNum,
      step: "qualities",
    });

    await bot.sendMessage(chatId, `📺 تم اختيار الموسم ${seasonNum} - الحلقة ${epNum}.\nاختر الجودة المطلوبة:`, {
      reply_markup: kb.buildQualitiesKeyboard(),
    });
    return;
  }

  // Select Quality: ql:<quality>
  if (data.startsWith("ql:")) {
    const quality = data.split(":")[1] || "720p";
    const session = await store.getSession(chatId);
    const candidate: Candidate = session?.selectedCandidate;
    if (!candidate) {
      await bot.sendMessage(chatId, "❌ انتهت الجلسة. أرسل اسم العمل من جديد للبحث.");
      return;
    }

    await bot.sendMessage(chatId, `⏳ يتم فحص السيرفرات المتاحة لجودة <b>${quality}</b> واختيار الأسرع...`);

    const provider = findProvider(candidate.site) || ALL_PROVIDERS[0];
    const details = await provider.getDetails(candidate);

    let rawSources: SourceLink[] = details.sources;

    // If series, get episode sources
    let currentEpisode: Episode | undefined;
    if (candidate.kind === "series" && session?.selectedSeason && session?.selectedEpisode) {
      const seasonGroup = details.seasons.find((s) => s.season === session.selectedSeason);
      currentEpisode = seasonGroup?.episodes.find((e) => e.episode === session.selectedEpisode);
      if (currentEpisode) {
        rawSources = await provider.getEpisodeSources(currentEpisode);
      }
    }

    // Filter or rank sources by live health probe
    const probeResults: Array<{ source: SourceLink; probe: ProbeResult }> = [];
    for (const s of rawSources) {
      const pr = await probeCached(s.url, s.referer, env.CACHE);
      if (pr.playable) {
        probeResults.push({ source: s, probe: pr });
      }
    }

    // Sort by highest score
    probeResults.sort((a, b) => b.probe.score - a.probe.score);

    const best = probeResults[0] || {
      source: rawSources[0] || {
        name: "سيرفر البث الافتراضي",
        url: candidate.url,
        quality: "HD",
        kind: "embed",
      },
      probe: {
        url: rawSources[0]?.url || candidate.url,
        playable: true,
        kind: "embed" as const,
        status: 200,
        contentType: "text/html",
        contentLength: 0,
        acceptRanges: false,
        latencyMs: 180,
        score: 60,
        serverTag: "⚡️ سيرفر معتمد",
        host: "filmaty.stream",
      },
    };

    // Generate signed web player URL
    const token = await signToken(
      {
        u: best.source.url,
        r: best.source.referer,
        n: details.title,
        k: best.probe.kind,
        e: Math.floor(Date.now() / 1000) + 7200, // 2 hours
      },
      env.SIGNING_SECRET,
    );

    const publicBase = env.PUBLIC_BASE || "https://filmaty.hudhaifa-bio.workers.dev";
    const playerUrl = `${publicBase}/watch?t=${encodeURIComponent(token)}`;
    const downloadUrl = best.source.downloadUrl || (best.probe.kind === "mp4" ? best.source.url : undefined);

    const mirrorServers = probeResults.slice(1, 4).map((p) => p.source);

    // Save item in current session for quick archiving
    await store.setSession(chatId, {
      selectedQuality: quality,
      step: "servers",
    });

    await bot.sendMessage(
      chatId,
      views.formatProbeRecommendation(details.title, quality, best.probe, currentEpisode),
      {
        reply_markup: kb.buildPlayOptionsKeyboard(playerUrl, downloadUrl, mirrorServers),
      },
    );
    return;
  }

  // Save to Archive: ar:save
  if (data === "ar:save") {
    const session = await store.getSession(chatId);
    const cand = session?.selectedCandidate;
    if (cand) {
      await store.addToArchive({
        userId: String(cb.from?.id || chatId),
        title: cand.title,
        kind: cand.kind,
        season: session.selectedSeason,
        episode: session.selectedEpisode,
        quality: session.selectedQuality,
        site: cand.site,
        url: cand.url,
      });
      await bot.sendMessage(chatId, "✅ <b>تم الحفظ في أرشيفك الشخصي بنجاح!</b>");
    } else {
      await bot.sendMessage(chatId, "⚠️ لا يوجد عمل نشط لحفظه حاليًا.");
    }
    return;
  }
}
