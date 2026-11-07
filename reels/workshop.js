// «Цех»: конвейер, который ведёт несколько рилсов одновременно.
// Сценарий → Голос → Раскадровка → Сборка → Пост → Публикация.
import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { db, saveDb } from "../db.js";
import { writeScript, hasAi } from "./writer.js";
import { voiceScript, voiceProvider, VOICE_DELAY } from "./voice.js";
import { makeMusic } from "./music.js";
import { makeSfx } from "./sfx.js";
import { renderReel, makeStrip, makeCover, waveform } from "./render.js";
import { pickPalette } from "./palettes.js";
import { publishReel, instagramReady, reelInsights } from "./instagram.js";

export const STAGES = ["Сценарий", "Голос", "Раскадровка", "Сборка", "Пост", "Публикация"];
export const MEDIA_DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "reels");
export const events = new EventEmitter();
events.setMaxListeners(100);

const RENDER_PARALLEL = Math.max(1, Number(process.env.REELS_RENDER_PARALLEL) || 2);
const now = () => new Date().toISOString();

// ---------- настройки («Пульт») ----------
const DEFAULT_SETTINGS = () => ({
  niche: process.env.REELS_NICHE || "Сервис «мастер на час»: сантехника, электрика, сборка мебели, навеска, мелкий ремонт",
  brandName: process.env.REELS_BRAND || "GoPromo",
  handle: process.env.REELS_HANDLE || "@gopromo.master",
  autopublish: process.env.REELS_AUTOPUBLISH === "1",
  autopilotTimes: process.env.REELS_AUTOPILOT || "",
  perRun: Number(process.env.REELS_PER_RUN) || 2
});

function store() {
  const s = db();
  s.reels ??= [];
  s.reelCounter ??= 41;
  s.reelSettings = { ...DEFAULT_SETTINGS(), ...(s.reelSettings || {}) };
  s.autopilotLog ??= {};
  return s;
}

export const settings = () => store().reelSettings;
export function updateSettings(patch) {
  const s = store();
  const allowed = ["niche", "brandName", "handle", "autopublish", "autopilotTimes", "perRun"];
  for (const k of allowed) if (k in patch) s.reelSettings[k] = k === "perRun" ? Math.max(1, Math.min(8, Number(patch[k]) || 1)) : k === "autopublish" ? Boolean(patch[k]) : String(patch[k]);
  saveDb();
  changed();
  return s.reelSettings;
}

// ---------- состояние ----------
let changeTimer = null;
function changed() {
  saveDb();
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => events.emit("change"), 150);
}

export const listReels = () => store().reels.slice().sort((a, b) => b.n - a.n);
export const getReel = (id) => store().reels.find((r) => r.id === id);

function note(reel, text) { reel.note = text; reel.noteAt = now(); changed(); }
function stage(reel, i, state = "doing") {
  reel.stage = i;
  reel.stages = STAGES.map((name, k) => ({ name, state: k < i ? "done" : k === i ? state : "todo" }));
  changed();
}
function progress(reel, p) { reel.progress = Math.max(0, Math.min(100, Math.round(p))); changed(); }

export function summary() {
  const r = store().reels;
  const today = new Date().toISOString().slice(0, 10);
  return {
    working: r.filter((x) => ["queued", "working", "publishing"].includes(x.status)).length,
    waiting: r.filter((x) => x.status === "waiting").length,
    published: r.filter((x) => x.status === "published").length,
    publishedToday: r.filter((x) => x.status === "published" && x.ig?.publishedAt?.startsWith(today)).length,
    ready: r.filter((x) => x.status === "ready").length,
    failed: r.filter((x) => x.status === "failed").length,
    ai: hasAi(),
    voice: voiceProvider(),
    instagram: instagramReady(),
    renderParallel: RENDER_PARALLEL
  };
}

// ---------- очередь на рендер (монтажные столы) ----------
let rendering = 0;
const renderQueue = [];
async function renderSlot(fn) {
  if (rendering >= RENDER_PARALLEL) await new Promise((r) => renderQueue.push(r));
  rendering++;
  try { return await fn(); } finally { rendering--; renderQueue.shift()?.(); }
}

// ---------- раскадровка: из сценария и голоса в описание для 3D-движка ----------
function storyboard(script, voice, set) {
  const scenes = script.scenes.map((s, i) => ({ ...s, start: +voice.times[i].start.toFixed(3), end: +voice.times[i].end.toFixed(3) }));
  const bursts = [];
  scenes.forEach((s) => {
    if (s.type === "solution") bursts.push(s.start + 0.5);
    if (s.type === "stat") bursts.push(s.start + 1.5);
    if (s.type === "cta") bursts.push(s.start + 0.7);
  });
  return {
    width: 1080, height: 1920, fps: 30,
    duration: voice.duration,
    palette: pickPalette(script.palette),
    brand: { name: set.brandName, handle: set.handle },
    bursts,
    scenes,
    words: voice.words
  };
}

// ---------- конвейер одного ролика ----------
async function pipeline(reel) {
  const set = settings();
  const dir = path.join(MEDIA_DIR, reel.id);
  fs.mkdirSync(dir, { recursive: true });
  reel.status = "working";
  reel.error = null;

  // 1. Сценарий
  if (!reel.script) {
    stage(reel, 0); progress(reel, 3); note(reel, hasAi() ? "Claude пишет сценарий" : "беру сценарий из библиотеки");
    const used = store().reels.filter((r) => r !== reel && r.script).flatMap((r) => [r.script.key, r.title].filter(Boolean));
    const script = await writeScript({ topic: reel.topic, niche: set.niche, brand: { name: set.brandName, handle: set.handle }, used });
    reel.script = script;
    reel.title = script.title;
    reel.by = script.by;
  }
  progress(reel, 12);

  // 2. Голос
  stage(reel, 1); note(reel, "озвучиваю с интонацией");
  const voice = await voiceScript(reel.script.scenes, dir);
  reel.voiceProvider = voice.provider;
  reel.duration = voice.duration;
  progress(reel, 25);

  // 3. Раскадровка
  stage(reel, 2); note(reel, "раскладываю по кадрам, пишу музыку и звуки");
  const spec = storyboard(reel.script, voice, set);
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(spec));
  const music = makeMusic(path.join(dir, "music.wav"), spec.duration, reel.n * 7 + 3);
  const sfx = process.env.REELS_SFX === "0" ? null : makeSfx(path.join(dir, "sfx.wav"), spec, reel.n * 13 + 5);
  reel.timeline = {
    duration: spec.duration,
    scenes: spec.scenes.map((s) => ({ type: s.type, start: s.start, end: s.end, title: s.title })),
    words: spec.words.map((w) => [w.t, w.d]),
    peaks: await waveform(voice.file, 140),
    bpm: music.bpm,
    sfx: sfx ? sfx.events.map((e) => [e.t, e.type]) : []
  };
  progress(reel, 32);

  // 4. Сборка
  stage(reel, 3);
  if (rendering >= RENDER_PARALLEL) note(reel, "жду свободный монтажный стол");
  const video = path.join(dir, "reel.mp4");
  await renderSlot(() => {
    note(reel, "собираю 3D-кадры");
    let lastNote = 0;
    return renderReel({
      spec, voice: voice.file, music: music.file, sfx: sfx?.file, out: video, voiceDelay: VOICE_DELAY,
      onProgress: (f, total) => {
        reel.progress = Math.round(32 + (58 * f) / total);
        if (Date.now() - lastNote > 1500 || f === total) { lastNote = Date.now(); reel.note = `собираю кадр ${f}/${total}`; reel.noteAt = now(); changed(); }
      }
    });
  });
  await makeStrip(video, path.join(dir, "strip.jpg"), 12);
  await makeCover(video, path.join(dir, "cover.jpg"), Math.min(1.2, spec.duration / 3));
  reel.files = { video: `/reels-media/${reel.id}/reel.mp4`, strip: `/reels-media/${reel.id}/strip.jpg`, cover: `/reels-media/${reel.id}/cover.jpg` };
  reel.size = fs.statSync(video).size;
  progress(reel, 90);

  // 5. Пост
  stage(reel, 4); note(reel, "пишу пост");
  const tags = (reel.script.hashtags || []).map((h) => `#${h}`).join(" ");
  reel.caption ??= [reel.script.caption, tags].filter(Boolean).join("\n\n");
  progress(reel, 99);

  // 6. Публикация: ждём «да» или выкладываем сами
  stage(reel, 5);
  if (reel.autopublish ?? set.autopublish) {
    if (instagramReady()) return publish(reel);
    reel.status = "ready";
    note(reel, "готов. Instagram не подключён, скачай и выложи");
    return;
  }
  reel.status = "waiting";
  stage(reel, 5, "waiting");
  note(reel, "Выкладываю?");
}

async function runPipeline(reel) {
  try {
    await pipeline(reel);
  } catch (e) {
    console.error(`[tseh] ${reel.id}:`, e);
    reel.status = "failed";
    reel.error = e.message;
    if (reel.stages?.[reel.stage]) reel.stages[reel.stage].state = "error";
    note(reel, `ошибка: ${e.message.slice(0, 140)}`);
  }
}

// ---------- публичные действия ----------
export function createReels({ count = 1, topics = [], autopublish } = {}) {
  const s = store();
  const n = Math.max(1, Math.min(8, Number(count) || 1));
  const made = [];
  for (let i = 0; i < n; i++) {
    const num = s.reelCounter++;
    const reel = {
      id: `ts-${num}`, n: num, createdAt: now(),
      topic: (topics[i] || "").trim(),
      account: settings().handle,
      status: "queued", progress: 0, title: (topics[i] || "").trim() || "Новый ролик",
      stages: STAGES.map((name) => ({ name, state: "todo" })), stage: 0,
      autopublish: autopublish === undefined ? undefined : Boolean(autopublish),
      note: "в очереди", noteAt: now()
    };
    s.reels.push(reel);
    made.push(reel);
  }
  changed();
  made.forEach((r) => runPipeline(r));
  return made;
}

async function publish(reel) {
  reel.status = "publishing";
  stage(reel, 5);
  try {
    const res = await publishReel({
      file: path.join(MEDIA_DIR, reel.id, "reel.mp4"),
      caption: reel.caption || "",
      coverOffsetMs: 1000,
      onStatus: (t) => note(reel, t)
    });
    reel.ig = { ...res, publishedAt: now() };
    reel.status = "published";
    reel.stages = STAGES.map((name) => ({ name, state: "done" }));
    progress(reel, 100);
    note(reel, "ставлю замер через 24 ч");
    setTimeout(() => measure(reel.id).catch(() => {}), 24 * 3600 * 1000).unref();
  } catch (e) {
    reel.status = "waiting";
    reel.error = e.message;
    stage(reel, 5, "error");
    note(reel, `Instagram: ${e.message.slice(0, 140)}`);
  }
}

export async function approve(id, { caption } = {}) {
  const reel = getReel(id);
  if (!reel) throw new Error("Ролик не найден");
  if (!["waiting", "ready"].includes(reel.status)) throw new Error("Ролик ещё не готов");
  if (caption !== undefined) reel.caption = caption;
  if (!instagramReady()) {
    reel.status = "ready";
    note(reel, "одобрен. Instagram не подключён, скачай и выложи");
    return reel;
  }
  publish(reel);
  return reel;
}

export function updateReel(id, patch) {
  const reel = getReel(id);
  if (!reel) throw new Error("Ролик не найден");
  if (typeof patch.caption === "string") reel.caption = patch.caption;
  changed();
  return reel;
}

export function reject(id) {
  const reel = getReel(id);
  if (!reel) throw new Error("Ролик не найден");
  reel.status = "rejected";
  note(reel, "отклонён");
  return reel;
}

// Переделать: новый сценарий (или тот же, если это была ошибка рендера)
export function redo(id, { keepScript = false } = {}) {
  const reel = getReel(id);
  if (!reel) throw new Error("Ролик не найден");
  if (["working", "publishing"].includes(reel.status)) throw new Error("Ролик сейчас в работе");
  if (!keepScript) { reel.script = null; reel.caption = undefined; reel.title = reel.topic || "Новый ролик"; }
  reel.status = "queued"; reel.progress = 0; reel.timeline = null; reel.files = null; reel.error = null;
  reel.stages = STAGES.map((name) => ({ name, state: "todo" }));
  note(reel, "в очереди");
  runPipeline(reel);
  return reel;
}

export async function measure(id) {
  const reel = getReel(id);
  if (!reel?.ig?.mediaId) throw new Error("Ролик ещё не опубликован");
  reel.insights = { ...(await reelInsights(reel.ig.mediaId)), at: now() };
  note(reel, `замер: ${reel.insights.views ?? 0} просмотров`);
  return reel;
}

// ---------- запуск и автопилот ----------
export function initWorkshop() {
  const s = store();
  for (const r of s.reels) {
    if (["queued", "working", "publishing"].includes(r.status)) {
      r.status = "failed";
      r.error = "прервано перезапуском сервера";
      r.note = "прервано перезапуском, нажми «Переделать»";
    }
  }
  saveDb();
  setInterval(autopilotTick, 30 * 1000).unref();
}

function autopilotTick() {
  const set = settings();
  const times = String(set.autopilotTimes || "").split(/[,\s]+/).filter((x) => /^\d{1,2}:\d{2}$/.test(x));
  if (!times.length) return;
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = d.toISOString().slice(0, 10);
  const log = store().autopilotLog;
  for (const t of times) {
    const norm = t.padStart(5, "0");
    const key = `${day} ${norm}`;
    if (norm === hm && !log[key]) {
      log[key] = now();
      console.log(`[tseh] автопилот ${key}: запускаю ${set.perRun} роликов`);
      createReels({ count: set.perRun });
    }
  }
}
