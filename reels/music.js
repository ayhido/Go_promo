// Позитивная фоновая музыка, синтезированная с нуля (никаких авторских прав).
// Аккорды мажорной прогрессии, бас, арпеджио, бочка, хлопки и хэты.
import fs from "fs";

const SR = 44100;
const PROGRESSIONS = [
  [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], // I–V–vi–IV
  [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]], // vi–IV–I–V
  [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]] // I–vi–IV–V
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function makeMusic(file, duration, seed = 1) {
  const r = rng(seed);
  const bpm = 104 + Math.floor(r() * 18);
  const key = 57 + Math.floor(r() * 7); // A3..D#4 как тоника
  const prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
  const beat = 60 / bpm;
  const bar = beat * 4;
  const n = Math.ceil((duration + 0.5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const noise = rng(seed + 99);

  const add = (i, v, pan = 0) => { if (i >= 0 && i < n) { L[i] += v * (1 - pan) * 0.5 * 2; R[i] += v * (1 + pan) * 0.5 * 2; } };

  const bars = Math.ceil(duration / bar) + 1;
  for (let b = 0; b < bars; b++) {
    const chord = prog[b % prog.length];
    const t0 = b * bar;
    const intro = b === 0;
    // пэд: мягкие гармоники с медленной атакой
    for (const [ci, semi] of chord.entries()) {
      const f = hz(key + semi);
      const s0 = Math.floor(t0 * SR), len = Math.floor(bar * SR);
      for (let k = 0; k < len; k++) {
        const t = k / SR;
        const env = Math.min(1, t / 0.25) * Math.min(1, (bar - t) / 0.15);
        const ph = 2 * Math.PI * f * (t0 + t);
        const v = (Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.3) + 0.15 * Math.sin(3 * ph) + 0.5 * Math.sin(ph * 1.003)) * 0.028 * env;
        add(s0 + k, v, ci === 0 ? -0.4 : ci === 2 ? 0.4 : 0);
      }
    }
    // бас восьмыми с «качанием»
    const root = hz(key + chord[0] - 24);
    for (let e = 0; e < 8; e++) {
      if (intro) break;
      const s0 = Math.floor((t0 + e * beat / 2) * SR), len = Math.floor((beat / 2) * SR);
      for (let k = 0; k < len; k++) {
        const t = k / SR;
        const env = Math.min(1, t / 0.01) * Math.exp(-t * 5) * Math.min(1, (len - k) / 200);
        const ph = 2 * Math.PI * root * t;
        add(s0 + k, Math.tanh(Math.sin(ph) * 2.2 + 0.3 * Math.sin(2 * ph)) * 0.16 * env);
      }
    }
    // арпеджио шестнадцатыми
    const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24, chord[2] + 12, chord[1] + 12, chord[0] + 24, chord[2] + 12];
    for (let s = 0; s < 16; s++) {
      const f = hz(key + arp[s % arp.length]);
      const s0 = Math.floor((t0 + (s * beat) / 4) * SR), len = Math.floor(0.22 * SR);
      for (let k = 0; k < len; k++) {
        const t = k / SR;
        const env = Math.exp(-t * 16);
        const ph = 2 * Math.PI * f * t;
        const tri = (2 / Math.PI) * Math.asin(Math.sin(ph));
        add(s0 + k, tri * 0.05 * env, s % 2 ? 0.5 : -0.5);
      }
    }
    if (intro) continue;
    for (let q = 0; q < 4; q++) {
      const tb = t0 + q * beat;
      // бочка
      const s0 = Math.floor(tb * SR);
      let ph = 0;
      for (let k = 0; k < 0.32 * SR; k++) {
        const t = k / SR;
        const f = 45 + 95 * Math.exp(-t * 28);
        ph += (2 * Math.PI * f) / SR;
        add(s0 + k, Math.sin(ph) * 0.5 * Math.exp(-t * 9));
      }
      // хлопок на 2 и 4
      if (q % 2 === 1) {
        for (let k = 0; k < 0.18 * SR; k++) {
          const t = k / SR;
          const env = (Math.exp(-t * 30) + 0.4 * Math.exp(-Math.max(0, t - 0.012) * 40)) * 0.5;
          add(s0 + k, (noise() * 2 - 1) * 0.11 * env, 0.1);
        }
      }
      // хэт на слабую долю
      const h0 = Math.floor((tb + beat / 2) * SR);
      let prev = 0;
      for (let k = 0; k < 0.05 * SR; k++) {
        const x = noise() * 2 - 1;
        add(h0 + k, (x - prev) * 0.035 * Math.exp(-(k / SR) * 70), 0.3);
        prev = x;
      }
    }
  }

  // мастер: плавный вход/выход и мягкий лимитер
  const fadeIn = 0.3 * SR, fadeOut = 1.6 * SR, end = Math.floor(duration * SR);
  const pcm = Buffer.alloc(end * 4);
  for (let i = 0; i < end; i++) {
    let g = Math.min(1, i / fadeIn) * Math.min(1, (end - i) / fadeOut);
    const l = Math.tanh(L[i] * 1.2) * g, rr = Math.tanh(R[i] * 1.2) * g;
    pcm.writeInt16LE(Math.round(l * 30000), i * 4);
    pcm.writeInt16LE(Math.round(rr * 30000), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
  return { file, bpm, beat, bar };
}
