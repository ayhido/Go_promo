import fs from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";

// ===================================================================
//  Сборка вертикального рилса 1080×1920 из сценария через ffmpeg:
//  крючок → слайды → призыв, крупный текст, тихая аудиодорожка
//  (Instagram надёжнее принимает видео со звуком; музыку добавьте в приложении).
// ===================================================================

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FONT_CANDIDATES = [
  process.env.RADAR_FONT,
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "C:/Windows/Fonts/arialbd.ttf"
].filter(Boolean);

export function reelSupport() {
  const ff = spawnSync(FFMPEG, ["-hide_banner", "-version"], { encoding: "utf-8" });
  const font = FONT_CANDIDATES.find(f => fs.existsSync(f));
  return { ffmpeg: ff.status === 0, font: font || "" };
}

function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).replace(/\s+/g, " ").trim().split(" ")) {
    if ((line + " " + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// эмодзи шрифт не рисует (получаются квадраты) — убираем их из текста на экране
const clean = s =>
  String(s || "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const THEMES = [
  { bg: "0x0b1020", accent: "0xffc531" },
  { bg: "0x101826", accent: "0x3ddc97" },
  { bg: "0x1a0f24", accent: "0xff5c8a" }
];

// путь в фильтре ffmpeg: экранируем \ : ' (Windows-пути тоже работают)
const esc = p => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

export async function renderReel(reel, outFile, { brand = "" } = {}) {
  const { ffmpeg, font } = reelSupport();
  if (!ffmpeg) throw new Error("ffmpeg не найден на сервере (установите ffmpeg или укажите FFMPEG_PATH)");
  if (!font) throw new Error("Не найден шрифт с кириллицей (укажите RADAR_FONT=путь к .ttf)");

  const work = fs.mkdtempSync(path.join(path.dirname(outFile), ".tmp-"));
  try {
    const frames = [
      { text: reel.hook, size: 88, wrap: 16, dur: 3 },
      ...reel.slides.slice(0, 6).map(s => ({ text: s, size: 66, wrap: 22, dur: Math.min(5, Math.max(3, s.length / 18)) })),
      { text: reel.cta, size: 70, wrap: 20, dur: 3 }
    ].filter(f => f.text);
    const theme = THEMES[Math.floor(Math.random() * THEMES.length)];

    const filters = [`drawbox=x=0:y=0:w=iw:h=14:color=${theme.accent}:t=fill`];
    let t = 0;
    let n = 0;
    const textFile = str => {
      const file = path.join(work, `t${n++}.txt`);
      fs.writeFileSync(file, str);
      return esc(file);
    };
    frames.forEach((f, i) => {
      const end = t + f.dur;
      const on = `enable='between(t,${t.toFixed(2)},${end.toFixed(2)})'`;
      const color = i === 0 ? theme.accent : "white";
      // мягкое появление каждого слайда
      const alpha = `alpha='min(1,(t-${t.toFixed(2)})*4)'`;
      // каждая строка отдельно — так она центрируется
      const lines = wrap(clean(f.text), f.wrap).split("\n");
      const lh = Math.round(f.size * 1.3);
      const top = 960 - (lines.length * lh) / 2;
      lines.forEach((line, k) => {
        filters.push(
          `drawtext=fontfile='${esc(font)}':textfile='${textFile(line)}':fontsize=${f.size}:fontcolor=${color}:` +
            `x=(w-text_w)/2:y=${Math.round(top + k * lh)}:${alpha}:${on}`
        );
      });
      filters.push(
        `drawtext=fontfile='${esc(font)}':text='${i + 1}/${frames.length}':fontsize=40:fontcolor=white@0.5:x=w-text_w-60:y=90:${on}`
      );
      t = end;
    });
    if (brand) {
      filters.push(`drawtext=fontfile='${esc(font)}':textfile='${textFile(clean(brand))}':fontsize=42:fontcolor=${theme.accent}:x=(w-text_w)/2:y=h-220`);
    }
    // полоса прогресса снизу
    filters.push(`drawbox=x=0:y=ih-24:w=iw:h=24:color=white@0.15:t=fill`);

    const args = [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=${theme.bg}:s=1080x1920:r=30:d=${t.toFixed(2)}`,
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-vf", filters.join(","),
      "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outFile
    ];
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, args);
      let err = "";
      p.stderr.on("data", d => (err += d));
      p.on("error", reject);
      p.on("close", code => (code === 0 ? resolve() : reject(new Error("ffmpeg: " + err.slice(-500)))));
    });
    return { duration: Math.round(t) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
