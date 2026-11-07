// Озвучка сценария. Каждая сцена озвучивается отдельно со своей интонацией,
// потом склеивается с короткими паузами. Отдаём точные тайминги сцен и слов.
import fs from "fs";
import path from "path";
import axios from "axios";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { run, ffprobeDuration } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAP = 0.2; // пауза между сценами, сек
export const VOICE_DELAY = 0.25; // голос стартует чуть позже картинки

// интонация по типу сцены: темп и высота
const MOOD = {
  hook: { rate: "+10%", pitch: "+6Hz", style: 0.75 },
  problem: { rate: "+2%", pitch: "-2Hz", style: 0.5 },
  steps: { rate: "+6%", pitch: "+2Hz", style: 0.55 },
  stat: { rate: "+8%", pitch: "+5Hz", style: 0.7 },
  solution: { rate: "+8%", pitch: "+6Hz", style: 0.75 },
  cta: { rate: "+5%", pitch: "+4Hz", style: 0.65 }
};

export function voiceProvider() {
  if (process.env.REELS_TTS === "none") return "none";
  if (process.env.ELEVENLABS_API_KEY && process.env.REELS_TTS !== "edge") return "elevenlabs";
  return "edge";
}

function python(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.PYTHON || "python3", args, { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || `tts exit ${c}`))));
    p.stdin.end(input);
  });
}

async function edgeTts(text, mood, mp3) {
  const voice = process.env.REELS_VOICE || "ru-RU-DmitryNeural";
  const json = mp3.replace(/\.mp3$/, ".json");
  await python([path.join(__dirname, "tts.py"), voice, mood.rate, mood.pitch, mp3, json], text);
  return JSON.parse(fs.readFileSync(json, "utf-8"));
}

async function elevenTts(text, mood, mp3) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
  const { data } = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    { text, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2", voice_settings: { stability: 0.35, similarity_boost: 0.8, style: mood.style, use_speaker_boost: true } },
    { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }, timeout: 60000 }
  );
  fs.writeFileSync(mp3, Buffer.from(data.audio_base64, "base64"));
  const a = data.alignment || data.normalized_alignment;
  const words = [];
  let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) words.push(cur); cur = null; return; }
    if (!cur) cur = { t: a.character_start_times_seconds[i], d: 0, w: "" };
    cur.w += ch;
    cur.d = a.character_end_times_seconds[i] - cur.t;
  });
  if (cur) words.push(cur);
  return words.map((w) => ({ ...w, w: w.w.replace(/^[«"(]+|[»")]+$/g, "") }));
}

// Без голоса: тишина, а слова раскладываем по примерной скорости речи.
async function silentTts(text, mp3) {
  const words = text.split(/\s+/).filter(Boolean);
  let t = 0;
  const out = words.map((w) => { const d = 0.12 + w.length * 0.055; const r = { t, d, w }; t += d + 0.05; return r; });
  await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", (t + 0.1).toFixed(2), mp3]);
  return out;
}

// Слова из сервиса идут без знаков препинания — возвращаем их из исходного текста,
// чтобы субтитры знали, где фраза закончилась.
function attachPunctuation(words, text) {
  const src = text.split(/\s+/).filter(Boolean);
  let j = 0;
  const norm = (s) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "");
  return words.map((w) => {
    const target = norm(w.w);
    for (let k = j; k < Math.min(src.length, j + 4); k++) {
      if (norm(src[k]).startsWith(target) || target.startsWith(norm(src[k]))) {
        j = k + 1;
        const m = src[k].match(/[.!?,:;…—]+$/);
        const clean = src[k].replace(/^[«"(]+|[»")]+$/g, "").replace(/[«»"()]/g, "");
        return { ...w, w: m ? clean : clean.replace(/[.!?,:;…]+$/, "") || w.w };
      }
    }
    return w;
  });
}

/**
 * scenes: [{type, say}] → { file, duration, words, times:[{start,end}] }
 */
export async function voiceScript(scenes, dir) {
  const provider = voiceProvider();
  const parts = await Promise.all(
    scenes.map(async (s, i) => {
      const mp3 = path.join(dir, `vo_${i}.mp3`);
      const mood = MOOD[s.type] || MOOD.steps;
      let words;
      try {
        if (provider === "elevenlabs") words = await elevenTts(s.say, mood, mp3);
        else if (provider === "edge") words = await edgeTts(s.say, mood, mp3);
        else words = await silentTts(s.say, mp3);
      } catch (e) {
        if (provider === "none") throw e;
        console.error(`[voice] ${provider}: ${e.message} — сцена ${i} без голоса`);
        words = await silentTts(s.say, mp3);
      }
      const dur = await ffprobeDuration(mp3);
      return { mp3, dur, words: attachPunctuation(words, s.say) };
    })
  );

  // склейка с паузами
  const out = path.join(dir, "voice.m4a");
  const args = ["-y", "-v", "error"];
  parts.forEach((p) => args.push("-i", p.mp3));
  const chains = parts.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur=${GAP}[a${i}]`).join(";");
  const fc = `${chains};${parts.map((_, i) => `[a${i}]`).join("")}concat=n=${parts.length}:v=0:a=1,loudnorm=I=-15:TP=-1.5:LRA=9[out]`;
  args.push("-filter_complex", fc, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", out);
  await run("ffmpeg", args);

  let off = 0;
  const words = [];
  const times = parts.map((p, i) => {
    const start = i === 0 ? 0 : off + VOICE_DELAY;
    p.words.forEach((w) => words.push({ t: +(w.t + off + VOICE_DELAY).toFixed(3), d: w.d, w: w.w }));
    off += p.dur + GAP;
    return { start, end: off + VOICE_DELAY };
  });
  const duration = +(off + VOICE_DELAY + 1.0).toFixed(2); // хвост, чтобы призыв повисел
  times[times.length - 1].end = duration;
  return { file: out, duration, words, times, provider };
}
