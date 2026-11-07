// Покадровый рендер 3D-сцены в headless Chromium и сборка MP4 через ffmpeg.
import http from "http";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".woff2": "font/woff2", ".json": "application/json" };
const MOUNTS = {
  "/engine/": path.join(__dirname, "engine"),
  "/three/": path.join(ROOT, "node_modules/three"),
  "/fonts/": path.join(ROOT, "node_modules/@fontsource/montserrat/files")
};

let serverPromise = null;
// маленький статический сервер только для движка (на случайном порту)
function engineServer() {
  if (serverPromise) return serverPromise;
  serverPromise = new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const mount = Object.keys(MOUNTS).find((m) => url.startsWith(m));
      if (!mount) { res.writeHead(404); return res.end(); }
      const file = path.normalize(path.join(MOUNTS[mount], url.slice(mount.length) || "index.html"));
      if (!file.startsWith(MOUNTS[mount])) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", () => { srv.unref(); resolve(`http://127.0.0.1:${srv.address().port}`); });
  });
  return serverPromise;
}

async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  try { return require("playwright"); } catch {}
  throw new Error("Не найден Playwright. Выполните: npm install && npx playwright install chromium");
}

let browserPromise = null;
async function browser() {
  if (!browserPromise) {
    const { chromium } = await loadPlaywright();
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"]
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise; browserPromise = null; await b.close(); }
}

function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "", out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}: ${err.slice(-800)}`))));
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export const ffprobeDuration = async (file) => parseFloat(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]));

/**
 * spec — описание ролика для движка (сцены, слова, палитра, длительность).
 * voice/music/sfx — пути к аудио (необязательно). out — путь к MP4.
 * onProgress(frame, total) — для прогресса в «Цехе».
 */
export async function renderReel({ spec, voice, music, sfx, out, onProgress, voiceDelay = 0.25 }) {
  const fps = spec.fps || 30;
  const total = Math.ceil(spec.duration * fps);
  const base = await engineServer();
  const b = await browser();
  const page = await b.newPage({ viewport: { width: 540, height: 960 } });
  page.on("pageerror", (e) => console.error("[engine]", e.message));
  try {
    await page.goto(`${base}/engine/index.html`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
    await page.evaluate((s) => window.setup(s), spec);

    const args = ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-"];
    const maps = ["-map", "0:v"];
    // звук: голос (с задержкой) + музыка (приседает под голос) + звуковые эффекты
    const inputs = [];
    for (const [kind, file] of [["voice", voice], ["music", music], ["sfx", sfx]]) if (file) { args.push("-i", file); inputs.push(kind); }
    const idx = (k) => inputs.indexOf(k) + 1;
    const parts = [], mix = [];
    const d = Math.round(voiceDelay * 1000);
    if (voice) {
      parts.push(`[${idx("voice")}:a]adelay=${d}|${d},aresample=48000,aformat=channel_layouts=stereo,apad${music ? ",asplit=2[v1][v2]" : "[v2]"}`);
      mix.push("[v2]");
    }
    if (music) {
      parts.push(`[${idx("music")}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.55[m]`);
      if (voice) { parts.push(`[m][v1]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[md]`); mix.push("[md]"); } else mix.push("[m]");
    }
    if (sfx) { parts.push(`[${idx("sfx")}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.8[fx]`); mix.push("[fx]"); }
    const fc = mix.length ? `${parts.join(";")};${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,alimiter=limit=0.95[a]` : null;
    if (fc) { args.push("-filter_complex", fc); maps.push("-map", "[a]"); }
    args.push(...maps, "-t", spec.duration.toFixed(3), "-c:v", "libx264", "-preset", process.env.REELS_X264_PRESET || "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps), "-profile:v", "high", "-movflags", "+faststart");
    if (fc) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
    args.push(out);

    const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    ff.stderr.on("data", (d) => (ffErr += d));
    const done = new Promise((resolve, reject) => ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg: " + ffErr.slice(-800))))));

    for (let i = 0; i < total; i++) {
      const data = await page.evaluate((t) => window.frame(t, 0.92), i / fps);
      const buf = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (onProgress && (i % 5 === 0 || i === total - 1)) onProgress(i + 1, total);
    }
    ff.stdin.end();
    await done;
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

// Один кадр в JPEG (для обложки и превью раскадровки без полного рендера).
export async function renderStill({ spec, t, out }) {
  const base = await engineServer();
  const b = await browser();
  const page = await b.newPage({ viewport: { width: 540, height: 960 } });
  try {
    await page.goto(`${base}/engine/index.html`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
    await page.evaluate((s) => window.setup(s), spec);
    const data = await page.evaluate((tt) => window.frame(tt, 0.9), t);
    fs.writeFileSync(out, Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

// Полоска кадров для таймлайна в «Цехе» и обложка.
export async function makeStrip(video, out, n = 10) {
  const dur = await ffprobeDuration(video);
  await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=${(n / dur).toFixed(4)},scale=72:128,tile=${n}x1`, "-frames:v", "1", out]);
  return out;
}

export async function makeCover(video, out, t = 1.0) {
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-q:v", "3", out]);
  return out;
}

// Пики громкости голоса для «волны» на таймлайне.
export async function waveform(file, points = 120) {
  const raw = await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
    const chunks = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("close", (c) => (c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("waveform"))));
    p.on("error", reject);
  });
  const n = Math.floor(raw.length / 2);
  const step = Math.max(1, Math.floor(n / points));
  const peaks = [];
  for (let i = 0; i < points; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(n, (i + 1) * step); j++) m = Math.max(m, Math.abs(raw.readInt16LE(j * 2)));
    peaks.push(+(m / 32768).toFixed(3));
  }
  return peaks;
}

export { run };
