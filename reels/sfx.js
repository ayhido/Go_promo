// Звуковой дизайн ролика: эффекты синтезируются с нуля (без чужих сэмплов и прав)
// и сами расставляются по таймлайну раскадровки. Ничего настраивать не нужно.
import fs from "fs";

const SR = 48000;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- генераторы звуков: (buf L/R, start sample, громкость, rnd) ----------
function put(L, R, i, v, pan = 0) {
  if (i < 0 || i >= L.length) return;
  L[i] += v * (1 - pan);
  R[i] += v * (1 + pan);
}

// свуш на склейке: шум, полосовой фильтр с ползущей частотой, нарастание и спад
function whoosh(L, R, s0, vol, rnd, dur = 0.42) {
  const n = Math.floor(dur * SR);
  let lp = 0, bp = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    const env = Math.sin(Math.PI * Math.pow(x, 0.7)) ** 2;
    const f = 300 + 3500 * Math.sin(Math.PI * x);
    const c = 2 * Math.sin((Math.PI * f) / SR);
    const nz = rnd() * 2 - 1;
    lp += c * bp; const hp = nz - lp - 0.6 * bp; bp += c * hp; // state-variable filter
    const pan = (x - 0.5) * 1.4;
    put(L, R, s0 + k, bp * 0.55 * env * vol, pan);
  }
}

// удар в начале (крючок): саб-бас с падающей частотой + щелчок
function impact(L, R, s0, vol, rnd) {
  let ph = 0;
  for (let k = 0; k < 0.9 * SR; k++) {
    const t = k / SR;
    const f = 38 + 120 * Math.exp(-t * 14);
    ph += (2 * Math.PI * f) / SR;
    const v = Math.sin(ph) * Math.exp(-t * 3.2) + (t < 0.03 ? (rnd() * 2 - 1) * (1 - t / 0.03) * 0.6 : 0);
    put(L, R, s0 + k, Math.tanh(v * 1.6) * 0.6 * vol);
  }
}

// «поп» появления карточки: короткий тон с быстрым спуском
function pop(L, R, s0, vol, pitch = 1, pan = 0) {
  let ph = 0;
  for (let k = 0; k < 0.11 * SR; k++) {
    const t = k / SR;
    const f = (900 - 500 * Math.min(1, t / 0.05)) * pitch;
    ph += (2 * Math.PI * f) / SR;
    put(L, R, s0 + k, Math.sin(ph) * Math.exp(-t * 45) * 0.45 * vol, pan);
  }
}

// тик счётчика
function tick(L, R, s0, vol, rnd) {
  for (let k = 0; k < 0.012 * SR; k++) put(L, R, s0 + k, (rnd() * 2 - 1) * Math.exp(-k / (0.002 * SR)) * 0.35 * vol, 0.2);
}

// «дзынь»: колокольчик из негармоничных обертонов
function ding(L, R, s0, vol, base = 1318.5) {
  const partials = [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]];
  for (let k = 0; k < 1.4 * SR; k++) {
    const t = k / SR;
    let v = 0;
    for (const [m, a] of partials) v += Math.sin(2 * Math.PI * base * m * t) * a * Math.exp(-t * (2.5 + m));
    put(L, R, s0 + k, v * 0.22 * vol * Math.min(1, k / 40));
  }
}

// искры под конфетти: россыпь высоких колокольчиков + хлопушка
function sparkle(L, R, s0, vol, rnd) {
  for (let k = 0; k < 0.08 * SR; k++) { const t = k / SR; put(L, R, s0 + k, (rnd() * 2 - 1) * Math.exp(-t * 60) * 0.5 * vol); }
  const notes = [2093, 2637, 3136, 2349, 2794, 3520, 4186];
  for (let j = 0; j < 9; j++) {
    const at = s0 + Math.floor((0.03 + rnd() * 0.7) * SR);
    const f = notes[Math.floor(rnd() * notes.length)];
    const pan = rnd() * 1.6 - 0.8;
    for (let k = 0; k < 0.35 * SR; k++) { const t = k / SR; put(L, R, at + k, Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 12) * 0.08 * vol, pan); }
  }
}

// подъём перед призывом
function riser(L, R, s0, vol, rnd, dur = 0.9) {
  const n = Math.floor(dur * SR);
  let lp = 0, bp = 0, ph = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    const f = 400 + 5000 * x * x;
    const c = 2 * Math.sin((Math.PI * Math.min(f, 9000)) / SR);
    const nz = rnd() * 2 - 1;
    lp += c * bp; const hp = nz - lp - 0.5 * bp; bp += c * hp;
    ph += (2 * Math.PI * (200 + 600 * x)) / SR;
    put(L, R, s0 + k, (bp * 0.3 + Math.sin(ph) * 0.08) * x * x * vol);
  }
}

// лёгкий «тап» на каждую новую фразу субтитров
function tap(L, R, s0, vol) {
  let ph = 0;
  for (let k = 0; k < 0.04 * SR; k++) { const t = k / SR; ph += (2 * Math.PI * 1800) / SR; put(L, R, s0 + k, Math.sin(ph) * Math.exp(-t * 120) * 0.12 * vol); }
}

// ---------- расстановка по раскадровке ----------
// Повторяет логику движка: когда что появляется на экране.
export function planSfx(spec) {
  const ev = [];
  const add = (t, type, extra = {}) => { if (t >= 0 && t < spec.duration) ev.push({ t: +t.toFixed(3), type, ...extra }); };
  spec.scenes.forEach((s, i) => {
    const dur = s.end - s.start;
    if (i === 0) add(0.02, "impact");
    else add(s.start - 0.2, "whoosh");
    switch (s.type) {
      case "hook": add(s.start + 0.12, "pop", { pitch: 1 }); break;
      case "problem": add(s.start + 0.1, "pop", { pitch: 0.7 }); break;
      case "solution": add(s.start + 0.2, "pop", { pitch: 1.2 }); add(s.start + 0.65, "ding", { base: 1568 }); break;
      case "steps": {
        const n = Math.min(4, (s.items || []).length);
        const span = Math.max(0.4, (dur - 0.8) / Math.max(1, n));
        if (s.title) add(s.start + 0.08, "pop", { pitch: 0.9 });
        for (let k = 0; k < n; k++) add(s.start + 0.3 + k * span, "pop", { pitch: 1 + k * 0.12, pan: 0.4 });
        break;
      }
      case "stat":
        for (let x = 0.25; x < 1.45; x += 0.07) add(s.start + x, "tick");
        add(s.start + 1.5, "ding", { base: 1318.5 });
        break;
      case "cta":
        add(s.start - 0.95, "riser");
        add(s.start + 0.35, "pop", { pitch: 1.3 });
        break;
    }
  });
  for (const b of spec.bursts || []) add(b, "sparkle");
  // тапы на фразы субтитров (тихо, только когда между фразами есть пауза)
  let last = -1;
  for (const w of spec.words || []) {
    if (w.t - last > 0.9) add(w.t - 0.02, "tap");
    last = w.t + w.d;
  }
  return ev.sort((a, b) => a.t - b.t);
}

export function makeSfx(file, spec, seed = 1, level = Number(process.env.REELS_SFX_LEVEL ?? 1)) {
  const n = Math.ceil(spec.duration * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rnd = rng(seed);
  const events = planSfx(spec);
  for (const e of events) {
    const s0 = Math.floor(e.t * SR);
    switch (e.type) {
      case "whoosh": whoosh(L, R, s0, 0.9, rnd); break;
      case "impact": impact(L, R, s0, 0.9, rnd); break;
      case "pop": pop(L, R, s0, 0.8, e.pitch, e.pan || 0); break;
      case "tick": tick(L, R, s0, 0.7, rnd); break;
      case "ding": ding(L, R, s0, 0.8, e.base); break;
      case "sparkle": sparkle(L, R, s0, 0.8, rnd); break;
      case "riser": riser(L, R, s0, 0.7, rnd); break;
      case "tap": tap(L, R, s0, 0.6); break;
    }
  }
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.tanh(L[i] * level) * 30000), i * 4);
    pcm.writeInt16LE(Math.round(Math.tanh(R[i] * level) * 30000), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
  return { file, events };
}
