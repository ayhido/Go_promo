import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as webpush from "web-push";
import { http, PROXY } from "./net.js";
import { SOURCES } from "./sources.js";
import { CATEGORIES, classify, ruleReel, enrichWithAi, aiEnabled } from "./analyze.js";
import { renderReel, reelSupport } from "./reel.js";
import { publishReel, igStatus } from "./instagram.js";

// ===================================================================
//  «Радар заработка»: каждые N минут обходит источники, отбирает то,
//  на чём можно заработать, присылает push на телефон и в Telegram,
//  готовит сценарии и видео рилсов и (по желанию) сам публикует их.
// ===================================================================

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "radar.json");
const REELS_DIR = path.join(DATA_DIR, "reels");
const INTERVAL_MIN = Number(process.env.RADAR_INTERVAL_MIN || 30);
const AI_BATCH = Number(process.env.RADAR_AI_BATCH || 10);
const KEEP_DAYS = 14;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT = process.env.RADAR_TG_CHAT_ID || process.env.TG_CHAT_ID;

const DEFAULT_SETTINGS = {
  minScore: 55, // от какой оценки присылать уведомление
  keywords: [], // ваши темы: находки с ними получают +15 к оценке
  mutedCategories: ["news"], // разделы без уведомлений
  autopublish: false, // сам собирать и публиковать рилс
  autopublishPerDay: 1,
  autopublishMinScore: 70,
  brand: "" // подпись внизу видео, например @ваш_ник
};

// ---------- хранилище ----------
let S = { items: [], subs: [], vapid: null, settings: { ...DEFAULT_SETTINGS }, sources: {}, lastRun: 0, publishedLog: [] };
try {
  if (fs.existsSync(FILE)) {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    S = { ...S, ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
  }
} catch (e) {
  console.error("Radar load error:", e.message);
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + ".tmp", JSON.stringify(S));
      fs.renameSync(FILE + ".tmp", FILE);
    } catch (e) {
      console.error("Radar save error:", e.message);
    }
  }, 300);
}
fs.mkdirSync(REELS_DIR, { recursive: true });

const keyOf = id => crypto.createHash("sha1").update(id).digest("hex").slice(0, 12);
const byKey = key => S.items.find(i => i.key === key);

// ---------- push-уведомления (Web Push, VAPID-ключи создаются один раз) ----------
if (!S.vapid) {
  S.vapid = webpush.generateVAPIDKeys();
  save();
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:radar@example.com", S.vapid.publicKey, S.vapid.privateKey);

async function pushAll(payload) {
  const body = JSON.stringify(payload);
  const dead = [];
  await Promise.all(
    S.subs.map(sub =>
      webpush.sendNotification(sub, body, { TTL: 6 * 3600, ...(PROXY ? { proxy: PROXY } : {}) }).catch(e => {
        if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint);
        else console.error("Push error:", e.statusCode || e.message);
      })
    )
  );
  if (dead.length) {
    S.subs = S.subs.filter(s => !dead.includes(s.endpoint));
    save();
  }
}

async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await http.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { chat_id: TG_CHAT, text, disable_web_page_preview: true });
  } catch (e) {
    console.error("Radar TG error:", e.message);
  }
}

const titleOf = i => i.ai?.title_ru || i.title;

async function notify(items) {
  if (!items.length) return;
  const top = items.slice(0, 3);
  for (const i of top) {
    await pushAll({
      title: `💡 ${CATEGORIES[i.category]} · ${i.score}`,
      body: titleOf(i) + (i.ai?.how_to_earn ? `\n${i.ai.how_to_earn.slice(0, 140)}` : ""),
      url: `/radar/#item=${i.key}`,
      tag: i.key
    });
  }
  if (items.length > top.length) {
    await pushAll({ title: `Ещё ${items.length - top.length} новых возможностей`, body: "Откройте радар, чтобы посмотреть все", url: "/radar/", tag: "more" });
  }
  await tg(
    "💡 Новое на радаре заработка\n\n" +
      items
        .slice(0, 8)
        .map(i => `• [${i.score}] ${titleOf(i)}\n  ${i.ai?.how_to_earn ? i.ai.how_to_earn.slice(0, 200) + "\n  " : ""}${i.url}`)
        .join("\n\n")
  );
}

// ---------- обход источников ----------
let running = null;

function applyAi(item, a) {
  item.ai = {
    title_ru: a.title_ru,
    how_to_earn: a.how_to_earn,
    steps: a.steps,
    start_cost: a.start_cost,
    difficulty: a.difficulty,
    risk: a.risk
  };
  if (CATEGORIES[a.category]) item.category = a.category;
  item.score = Math.max(0, Math.min(100, Math.round(a.money_score + (item.matched?.length || 0) * 15)));
  item.reel = { ...a.reel, by: "ai" };
}

async function analyze(items) {
  if (!aiEnabled() || !items.length) return;
  for (let k = 0; k < items.length; k += AI_BATCH) {
    const batch = items.slice(k, k + AI_BATCH);
    try {
      const res = await enrichWithAi(batch);
      for (const a of res) {
        const item = batch.find(i => i.id === a.id);
        if (item) applyAi(item, a);
      }
    } catch (e) {
      console.error("Radar AI error:", e.message);
    }
  }
}

export async function runRadar() {
  if (running) return running;
  running = (async () => {
    const firstRun = S.items.length === 0;
    const known = new Map(S.items.map(i => [i.id, i]));
    const fresh = [];

    const results = await Promise.allSettled(SOURCES.map(s => s.run()));
    results.forEach((r, k) => {
      const src = SOURCES[k];
      if (r.status === "fulfilled") {
        S.sources[src.key] = { name: src.name, ok: true, count: r.value.length, at: Date.now() };
        for (const raw of r.value) {
          const old = known.get(raw.id);
          if (old) {
            old.engagement = Math.max(old.engagement, raw.engagement);
            continue;
          }
          const item = { ...raw, key: keyOf(raw.id), foundAt: Date.now() };
          Object.assign(item, classify(item, S.settings));
          known.set(item.id, item);
          fresh.push(item);
        }
      } else {
        const msg = r.reason?.response?.status ? `HTTP ${r.reason.response.status}` : r.reason?.message;
        S.sources[src.key] = { name: src.name, ok: false, error: msg, at: Date.now() };
      }
    });

    // Claude разбирает только самое перспективное (экономия запросов)
    const candidates = fresh.filter(i => i.score >= 30).sort((a, b) => b.score - a.score).slice(0, AI_BATCH * 2);
    await analyze(candidates);

    S.items.push(...fresh);
    prune();
    S.lastRun = Date.now();
    save();

    // в первый запуск ничего не присылаем, иначе придут сотни уведомлений
    const worth = fresh
      .filter(i => !firstRun && i.score >= S.settings.minScore && !i.risk && !S.settings.mutedCategories.includes(i.category))
      .sort((a, b) => b.score - a.score);
    for (const i of fresh) i.notified = true;
    await notify(worth);

    if (S.settings.autopublish) await autopublish().catch(e => console.error("Autopublish:", e.message));
    return { found: fresh.length, notified: worth.length };
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

function prune() {
  const edge = Date.now() - KEEP_DAYS * 864e5;
  S.items = S.items
    .filter(i => i.foundAt > edge || i.starred || i.published)
    .sort((a, b) => b.foundAt - a.foundAt)
    .slice(0, 4000);
  const alive = new Set(S.items.map(i => i.video?.file).filter(Boolean));
  for (const f of fs.readdirSync(REELS_DIR)) if (f.endsWith(".mp4") && !alive.has(f)) fs.rmSync(path.join(REELS_DIR, f), { force: true });
}

// ---------- рилсы ----------
const reelOf = i => i.reel || { ...ruleReel(i), by: "rules" };
const captionOf = (i, reel) => `${reel.caption}\n\n${(reel.hashtags || []).join(" ")}`.trim();

async function makeVideo(item) {
  const file = `${item.key}-${Date.now()}.mp4`;
  const out = path.join(REELS_DIR, file);
  const { duration } = await renderReel(reelOf(item), out, { brand: S.settings.brand });
  if (item.video?.file) fs.rmSync(path.join(REELS_DIR, item.video.file), { force: true });
  item.video = { file, duration, at: Date.now() };
  save();
  return item.video;
}

let publishing = false;
async function publish(item) {
  const ig = igStatus();
  if (!ig.ready) throw new Error("Instagram не настроен: задайте на сервере " + ig.missing.join(", "));
  if (publishing) throw new Error("Уже идёт публикация, подождите");
  publishing = true;
  try {
    if (!item.video) await makeVideo(item);
    const videoUrl = `${process.env.PUBLIC_URL.replace(/\/$/, "")}/radar/media/${item.video.file}`;
    const res = await publishReel({ videoUrl, caption: captionOf(item, reelOf(item)) });
    item.published = { at: Date.now(), ...res };
    S.publishedLog.push(Date.now());
    save();
    await tg(`📲 Рилс опубликован: ${titleOf(item)}\n${res.permalink || ""}`);
    return item.published;
  } catch (e) {
    item.publishError = e.message;
    save();
    throw e;
  } finally {
    publishing = false;
  }
}

async function autopublish() {
  if (!igStatus().ready || !reelSupport().ffmpeg) return;
  const today = S.publishedLog.filter(t => t > Date.now() - 864e5).length;
  if (today >= S.settings.autopublishPerDay) return;
  const next = S.items
    .filter(i => !i.published && !i.publishError && !i.risk && !i.ai?.risk?.match(/мошен|скам|пирамид/i))
    .filter(i => i.score >= S.settings.autopublishMinScore && i.foundAt > Date.now() - 2 * 864e5)
    .filter(i => !["news", "trend"].includes(i.category))
    .sort((a, b) => b.score - a.score)[0];
  if (next) await publish(next);
}

// ---------- API ----------
const view = i => ({
  key: i.key,
  title: i.title,
  titleRu: i.ai?.title_ru || "",
  url: i.url,
  summary: i.summary,
  source: i.sourceName,
  category: i.category,
  score: i.score,
  risk: i.risk || "",
  matched: i.matched || [],
  engagement: i.engagement,
  publishedAt: i.publishedAt,
  foundAt: i.foundAt,
  starred: Boolean(i.starred),
  ai: i.ai || null,
  reel: reelOf(i),
  video: i.video ? `/radar/media/${i.video.file}` : "",
  published: i.published || null,
  publishError: i.publishError || ""
});

function auth(req, res, next) {
  const pass = process.env.RADAR_PASSWORD;
  if (!pass || req.get("x-radar-key") === pass) return next();
  res.status(401).json({ error: "Нужен пароль радара" });
}

const wrap = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error("Radar API:", e.message);
    res.status(500).json({ error: e.message });
  }
};

export function mountRadar(app) {
  app.use("/radar/media", express.static(REELS_DIR, { maxAge: "7d" }));
  const r = express.Router();
  r.use(auth);

  r.get("/state", (req, res) => {
    const counts = {};
    for (const i of S.items) counts[i.category] = (counts[i.category] || 0) + 1;
    res.json({
      categories: CATEGORIES,
      counts,
      total: S.items.length,
      settings: S.settings,
      sources: S.sources,
      lastRun: S.lastRun,
      running: Boolean(running),
      intervalMin: INTERVAL_MIN,
      vapidPublicKey: S.vapid.publicKey,
      subscribers: S.subs.length,
      ai: aiEnabled(),
      telegram: Boolean(TG_TOKEN && TG_CHAT),
      proxy: Boolean(PROXY),
      instagram: igStatus(),
      video: reelSupport(),
      publishedToday: S.publishedLog.filter(t => t > Date.now() - 864e5).length
    });
  });

  r.get("/items", (req, res) => {
    const { category, q, starred } = req.query;
    const min = Number(req.query.min || 0);
    const sort = req.query.sort || "new";
    const needle = String(q || "").toLowerCase();
    let list = S.items.filter(
      i =>
        (!category || i.category === category) &&
        i.score >= min &&
        (!starred || i.starred) &&
        (!needle || `${i.title} ${i.summary} ${i.ai?.title_ru || ""}`.toLowerCase().includes(needle))
    );
    list = list.sort(sort === "score" ? (a, b) => b.score - a.score || b.foundAt - a.foundAt : (a, b) => b.foundAt - a.foundAt);
    res.json(list.slice(0, Math.min(300, Number(req.query.limit || 100))).map(view));
  });

  r.get("/items/:key", (req, res) => {
    const i = byKey(req.params.key);
    if (!i) return res.status(404).json({ error: "Не найдено" });
    res.json(view(i));
  });

  r.patch("/items/:key", (req, res) => {
    const i = byKey(req.params.key);
    if (!i) return res.status(404).json({ error: "Не найдено" });
    if ("starred" in req.body) i.starred = Boolean(req.body.starred);
    if (req.body.reel) {
      const { hook, slides, cta, caption, hashtags, shooting } = req.body.reel;
      i.reel = { hook, slides: (slides || []).filter(Boolean), cta, caption, hashtags: hashtags || [], shooting, by: "you" };
    }
    save();
    res.json(view(i));
  });

  r.post(
    "/items/:key/analyze",
    wrap(async (req, res) => {
      const i = byKey(req.params.key);
      if (!i) return res.status(404).json({ error: "Не найдено" });
      if (!aiEnabled()) return res.status(400).json({ error: "Нет ANTHROPIC_API_KEY на сервере" });
      const [a] = await enrichWithAi([i]);
      if (a) applyAi(i, a);
      save();
      res.json(view(i));
    })
  );

  r.post(
    "/items/:key/video",
    wrap(async (req, res) => {
      const i = byKey(req.params.key);
      if (!i) return res.status(404).json({ error: "Не найдено" });
      await makeVideo(i);
      res.json(view(i));
    })
  );

  r.post(
    "/items/:key/publish",
    wrap(async (req, res) => {
      const i = byKey(req.params.key);
      if (!i) return res.status(404).json({ error: "Не найдено" });
      await publish(i);
      res.json(view(i));
    })
  );

  r.post(
    "/refresh",
    wrap(async (req, res) => {
      res.json(await runRadar());
    })
  );

  r.put("/settings", (req, res) => {
    const b = req.body || {};
    const s = S.settings;
    if (b.minScore != null) s.minScore = Math.max(0, Math.min(100, Number(b.minScore)));
    if (Array.isArray(b.keywords)) s.keywords = b.keywords.map(k => String(k).trim()).filter(Boolean).slice(0, 50);
    if (Array.isArray(b.mutedCategories)) s.mutedCategories = b.mutedCategories.filter(c => CATEGORIES[c]);
    if (b.autopublish != null) s.autopublish = Boolean(b.autopublish);
    if (b.autopublishPerDay != null) s.autopublishPerDay = Math.max(1, Math.min(10, Number(b.autopublishPerDay)));
    if (b.autopublishMinScore != null) s.autopublishMinScore = Math.max(0, Math.min(100, Number(b.autopublishMinScore)));
    if (b.brand != null) s.brand = String(b.brand).slice(0, 40);
    // пересчитать оценки с новыми ключевыми словами (кроме разобранных ИИ — там слова учитываются поверх)
    for (const i of S.items) {
      const c = classify(i, s);
      i.matched = c.matched;
      if (!i.ai) i.score = c.score;
    }
    save();
    res.json(s);
  });

  r.post("/push/subscribe", (req, res) => {
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: "Нет подписки" });
    S.subs = S.subs.filter(s => s.endpoint !== sub.endpoint).concat(sub);
    save();
    res.json({ ok: true });
  });

  r.post("/push/unsubscribe", (req, res) => {
    S.subs = S.subs.filter(s => s.endpoint !== req.body?.endpoint);
    save();
    res.json({ ok: true });
  });

  r.post(
    "/push/test",
    wrap(async (req, res) => {
      await pushAll({ title: "Радар заработка", body: "Уведомления работают ✅", url: "/radar/", tag: "test" });
      res.json({ ok: true, subscribers: S.subs.length });
    })
  );

  app.use("/api/radar", r);

  // обход по расписанию
  setTimeout(() => runRadar().catch(e => console.error("Radar:", e.message)), 5000).unref();
  setInterval(() => runRadar().catch(e => console.error("Radar:", e.message)), INTERVAL_MIN * 60000).unref();
}
