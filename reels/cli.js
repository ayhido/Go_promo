#!/usr/bin/env node
// Запуск «Цеха» из консоли: npm run reels -- --count 3 [--topic "тема"] [--publish]
import { loadDb, saveDb } from "../db.js";
import { initWorkshop, createReels, getReel, approve } from "./workshop.js";
import { closeBrowser } from "./render.js";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const count = Number(opt("count", 1));
const topics = args.filter((_, i) => args[i - 1] === "--topic");
const publishNow = args.includes("--publish");

loadDb();
initWorkshop();
const made = createReels({ count, topics });
console.log(`Запущено: ${made.map((r) => r.id).join(", ")}`);

const t0 = Date.now();
const timer = setInterval(async () => {
  const reels = made.map((r) => getReel(r.id));
  const line = reels.map((r) => `${r.id} ${String(r.progress).padStart(3)}% ${r.note}`).join(" | ");
  process.stdout.write(`\r${line.slice(0, process.stdout.columns ? process.stdout.columns - 1 : 200)}`);
  if (reels.every((r) => !["queued", "working", "publishing"].includes(r.status))) {
    clearInterval(timer);
    console.log(`\n\nГотово за ${Math.round((Date.now() - t0) / 1000)} с`);
    for (const r of reels) {
      console.log(`${r.id}: ${r.status} — «${r.title}» ${r.duration ? r.duration + " с" : ""} ${r.files?.video ? "data/reels/" + r.id + "/reel.mp4" : r.error || ""}`);
      if (publishNow && r.status === "waiting") await approve(r.id);
    }
    if (!publishNow) { saveDb(); await closeBrowser(); setTimeout(() => process.exit(0), 400); }
  }
}, 1000);
