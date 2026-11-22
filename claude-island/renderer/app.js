'use strict';
/* Claude Island — плашка с этапами работы Claude Code и «живым» ползунком. */

// ───────────────────────── элементы ─────────────────────────
const $ = (id) => document.getElementById(id);
const island = $('island');
const elClock = $('clock');
const elProject = $('project');
const elTimer = $('timer');
const elStatus = $('status');
const elBubble = $('bubble');
const labels = [...document.querySelectorAll('.labels span')];
const canvas = $('bar');
const ctx = canvas.getContext('2d');

const STAGES = 4; // Чтение, Правка, Тесты, Готово
const HOLD_DONE_MS = 8000; // сколько держать зелёную плашку
const FADE_MS = 2200;

// ───────────────────────── состояние ─────────────────────────
const S = {
  mode: 'idle', // idle | work | wait | done
  session: null,
  startedAt: 0,
  finishedAt: 0,
  stage: 0, // 0..3
  stageAt: 0,
  thinking: true, // ещё не было ни одного инструмента
};

// ───────────────────────── тексты ─────────────────────────
const base = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '');
const short = (s, n = 42) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const TEST_RE = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|mocha|phpunit|rspec|unittest|playwright test|go test|cargo test|dotnet test|mvn test|gradle test|tox)\b/i;

function classify(tool, input = {}) {
  const file = base(input.file_path || input.notebook_path || input.path);
  switch (tool) {
    case 'Read': return { stage: 0, text: `Читаю ${file || 'файл'}` };
    case 'Grep': return { stage: 0, text: `Ищу «${short(input.pattern, 24)}»` };
    case 'Glob': case 'LS': return { stage: 0, text: 'Смотрю файлы проекта' };
    case 'WebSearch': return { stage: 0, text: `Ищу в интернете: ${short(input.query, 26)}` };
    case 'WebFetch': return { stage: 0, text: 'Читаю страницу' };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { stage: 1, text: `Правлю ${file || 'код'}` };
    case 'Write': return { stage: 1, text: `Создаю ${file || 'файл'}` };
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return { stage: null, text: 'Составляю план' };
    case 'Task': case 'Agent': return { stage: null, text: 'Подключаю помощника' };
    case 'Bash': {
      const cmd = input.command || '';
      if (TEST_RE.test(cmd)) return { stage: 2, text: 'Запускаю тесты' };
      return { stage: null, text: `Выполняю: ${short(input.description || cmd, 34)}` };
    }
    default:
      if (tool && tool.startsWith('mcp__')) return { stage: null, text: `Инструмент: ${short(tool.split('__').pop(), 28)}` };
      return { stage: null, text: `Работаю: ${tool || '…'}` };
  }
}

function translateNotice(msg = '') {
  if (/permission/i.test(msg)) {
    const m = msg.match(/use (\S+)/i);
    return m ? `Нужно разрешение: ${m[1]}` : 'Нужно твоё разрешение';
  }
  if (/waiting for your input/i.test(msg)) return 'Жду твоего ответа';
  return short(msg, 40) || 'Нужно твоё внимание';
}

// ───────────────────────── часы и таймер ─────────────────────────
const dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function tickText() {
  const now = new Date();
  const d = dateFmt.format(now).replace(/\.$/, '');
  elClock.innerHTML = `${d} <b>${timeFmt.format(now)}</b>`;
  if (S.mode !== 'idle') {
    const end = S.mode === 'done' ? S.finishedAt : Date.now();
    elTimer.textContent = fmtDuration(end - S.startedAt);
  }
}
setInterval(tickText, 250);

// ───────────────────────── показ / скрытие ─────────────────────────
let hideTimer = null;
let fadeTimer = null;

function show() {
  clearTimeout(hideTimer);
  clearTimeout(fadeTimer);
  island.classList.remove('fading', 'hidden');
}
function scheduleHide(delay) {
  clearTimeout(hideTimer);
  clearTimeout(fadeTimer);
  hideTimer = setTimeout(() => {
    island.classList.add('fading');
    fadeTimer = setTimeout(() => {
      island.classList.add('hidden');
      island.classList.remove('fading');
      S.mode = 'idle';
      island.dataset.state = 'idle';
    }, FADE_MS);
  }, delay);
}

function setMode(mode) {
  S.mode = mode;
  island.dataset.state = mode;
}

function setStatus(text) {
  if (elStatus.textContent === text) return;
  elStatus.textContent = text;
  elStatus.animate(
    [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
    { duration: 280, easing: 'ease-out' },
  );
}

let typingTimer = null;
function setBubble(text, { typing = false } = {}) {
  clearInterval(typingTimer);
  elBubble.classList.remove('typing');
  if (!text) { elBubble.classList.remove('show'); return; }
  elBubble.classList.add('show');
  if (!typing) { elBubble.textContent = text; return; }
  // Печатаем сообщение по буквам — как будто Claude говорит прямо сейчас.
  let i = 0;
  elBubble.textContent = '';
  elBubble.classList.add('typing');
  typingTimer = setInterval(() => {
    i += Math.max(1, Math.round(text.length / 90));
    elBubble.textContent = text.slice(0, i);
    if (i >= text.length) { clearInterval(typingTimer); elBubble.classList.remove('typing'); }
  }, 18);
}

function updateLabels() {
  labels.forEach((el, i) => {
    el.classList.toggle('past', i < S.stage);
    el.classList.toggle('now', i === S.stage);
  });
}

function setStage(stage) {
  if (stage == null || stage <= S.stage) return;
  S.stage = stage;
  S.stageAt = performance.now();
  bar.kick();
  updateLabels();
}

function startRun(evt) {
  S.session = evt.session || null;
  S.startedAt = evt.ts || Date.now();
  S.finishedAt = 0;
  S.stage = 0;
  S.stageAt = performance.now();
  S.thinking = true;
  bar.reset();
  elProject.textContent = base(evt.cwd) || 'проект';
  updateLabels();
  setMode('work');
  setStatus('Думаю…');
  setBubble(evt.prompt ? `«${short(evt.prompt.replace(/\s+/g, ' '), 160)}»` : '');
  show();
}

// ───────────────────────── обработка событий хуков ─────────────────────────
function handle(evt) {
  if (!evt || !evt.event) return;
  if (evt.event === '__demo') { runDemo(); return; }
  const sameSession = !S.session || !evt.session || evt.session === S.session;

  switch (evt.event) {
    case 'UserPromptSubmit':
      startRun(evt);
      break;

    case 'PreToolUse': {
      if (S.mode === 'idle' || S.mode === 'done' || !sameSession) startRun(evt);
      if (S.mode === 'wait') setMode('work');
      S.thinking = false;
      const c = classify(evt.tool, evt.input);
      setStage(c.stage);
      setStatus(c.text);
      break;
    }

    case 'Notification': {
      const msg = evt.message || '';
      // «Жду ввода» после завершения не должно снова поднимать плашку.
      if ((S.mode === 'idle' || S.mode === 'done') && !/permission/i.test(msg)) return;
      if (S.mode === 'idle' || S.mode === 'done') startRun(evt);
      setMode('wait');
      setStatus(translateNotice(msg));
      show();
      break;
    }

    case 'Stop': {
      if (S.mode === 'idle') startRun(evt);
      S.finishedAt = evt.ts || Date.now();
      S.stage = 3;
      updateLabels();
      setMode('done');
      setStatus('Готово · все шаги');
      setBubble(evt.last || 'Готово!', { typing: true });
      bar.finish();
      tickText();
      scheduleHide(HOLD_DONE_MS);
      break;
    }

    case 'SessionEnd':
      if (sameSession) scheduleHide(600);
      break;
  }
}

// ───────────────────────── живой ползунок (canvas) ─────────────────────────
const bar = (() => {
  const ORANGE = [[224, 123, 83], [247, 166, 122]];
  const GREEN = [[16, 185, 129], [110, 231, 183]];
  const AMBER = [[245, 158, 11], [252, 211, 77]];
  const GAP = 10;
  const THICK = 6;

  let W = 0, H = 0, dpr = 1;
  let v = 0, vel = 0; // показанное значение и скорость (пружина)
  let colorMix = 0; // 0 — оранжевый, 1 — зелёный
  let waitMix = 0;
  let sweep = -1; // финальная «волна» света
  let burstDone = false;
  const parts = [];
  let last = performance.now();
  let emitAcc = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  const segW = () => (W - GAP * (STAGES - 1)) / STAGES;
  const segX = (i) => i * (segW() + GAP);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixRGB = (a, b, t) => a.map((x, i) => Math.round(lerp(x, b[i], t)));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function palette() {
    let lo = mixRGB(ORANGE[0], GREEN[0], colorMix);
    let hi = mixRGB(ORANGE[1], GREEN[1], colorMix);
    if (waitMix > 0) {
      lo = mixRGB(lo, AMBER[0], waitMix);
      hi = mixRGB(hi, AMBER[1], waitMix);
    }
    return { lo, hi };
  }

  // Куда «тянется» ползунок: внутри текущего этапа он медленно ползёт вперёд,
  // никогда не упираясь в конец этапа — поэтому всегда в движении.
  function target(now) {
    if (S.mode === 'done') return 1;
    if (S.mode === 'idle') return v;
    const elapsed = (now - S.stageAt) / 1000;
    const cap = S.thinking ? 0.35 : 0.88;
    const tau = S.thinking ? 9 : 5;
    return (S.stage + cap * (1 - Math.exp(-elapsed / tau))) / STAGES;
  }

  function headPos() {
    const filled = Math.min(v, 1) * STAGES;
    const i = Math.min(STAGES - 1, Math.floor(filled));
    const f = Math.min(1, filled - i);
    return { x: segX(i) + segW() * f, i };
  }

  function emit(x, y, n, spread, speed, c) {
    for (let k = 0; k < n; k++) {
      const a = spread * (Math.random() * 2 - 1);
      const sp = speed * (0.4 + Math.random() * 0.8);
      parts.push({
        x, y,
        vx: -Math.cos(a) * sp * (Math.random() < 0.15 ? -0.6 : 1),
        vy: Math.sin(a) * sp - 8,
        life: 0, max: 0.5 + Math.random() * 0.7,
        r: 0.7 + Math.random() * 1.6,
        c,
      });
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    // Пружина: значение догоняет цель с лёгким перелётом — движение «упругое».
    const k = S.mode === 'done' ? 55 : 90;
    const c = 2 * 0.62 * Math.sqrt(k);
    vel += (k * (target(now) - v) - c * vel) * dt;
    v += vel * dt;
    v = Math.max(0, Math.min(1.03, v));

    colorMix = lerp(colorMix, S.mode === 'done' ? 1 : 0, 1 - Math.exp(-dt * (S.mode === 'done' ? 3 : 8)));
    waitMix = lerp(waitMix, S.mode === 'wait' ? 0.5 + 0.5 * Math.sin(t * 5) : 0, 1 - Math.exp(-dt * 10));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { lo, hi } = palette();
    const sw = segW();
    const y0 = H / 2;
    const head = headPos();
    const active = S.mode === 'work' || S.mode === 'wait';

    // дорожка
    for (let i = 0; i < STAGES; i++) {
      roundRect(segX(i), y0 - THICK / 2, sw, THICK, THICK / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fill();
    }

    // заливка + переливы (обрезаем по заполненной части)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < STAGES; i++) {
      const f = Math.max(0, Math.min(1, Math.min(v, 1) * STAGES - i));
      if (f <= 0) continue;
      // активный сегмент «дышит» по толщине
      const breathe = i === head.i && active ? Math.sin(t * 3.2) * 0.9 : 0;
      const th = THICK + breathe;
      const r = th / 2;
      const x = segX(i), w = Math.max(th, sw * f), y = y0 - th / 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + th, r);
      ctx.arcTo(x + w, y + th, x, y + th, r);
      ctx.arcTo(x, y + th, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    ctx.clip();

    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, rgba(lo, 1));
    g.addColorStop(1, rgba(hi, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // бегущие «энергетические» полоски
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#fff';
    const stripe = 22;
    const off = (t * 38) % (stripe * 2);
    for (let x = -stripe * 2 + off; x < W + stripe; x += stripe * 2) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + stripe * 0.6, H);
      ctx.lineTo(x + stripe * 0.6 + H, 0);
      ctx.lineTo(x + H, 0);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // блик, пробегающий по заливке
    const period = 2.4;
    const shine = ((t % period) / period) * (W + 160) - 80;
    const sg = ctx.createLinearGradient(shine - 70, 0, shine + 70, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(shine - 70, 0, 140, H);

    // финальная волна по всем сегментам
    if (sweep >= 0) {
      sweep += dt * 1.5;
      const sx = sweep * (W + 200) - 100;
      const wg = ctx.createLinearGradient(sx - 100, 0, sx + 100, 0);
      wg.addColorStop(0, 'rgba(255,255,255,0)');
      wg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      wg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = wg;
      ctx.fillRect(sx - 100, 0, 200, H);
      if (sweep > 1) sweep = -1;
    }
    ctx.restore();

    // «голова» ползунка: дышащее свечение
    if (v > 0.004 && (active || (S.mode === 'done' && v < 0.995))) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);
      const hx = Math.min(head.x, W - 2);
      const halo = ctx.createRadialGradient(hx, y0, 0, hx, y0, 13 + pulse * 4);
      halo.addColorStop(0, rgba(hi, 0.55));
      halo.addColorStop(1, rgba(hi, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(hx, y0, 13 + pulse * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowColor = rgba(hi, 0.9);
      ctx.shadowBlur = 12 + pulse * 8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(hx, y0, 3.6 + pulse * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // искры: чем быстрее движется ползунок, тем их больше
      emitAcc += dt * (10 + Math.min(120, Math.abs(vel) * 900));
      const n = Math.floor(emitAcc);
      emitAcc -= n;
      if (n) emit(hx, y0, n, 0.9, 45, hi);
    }

    // финал: вспышка искр в конце ползунка
    if (S.mode === 'done' && !burstDone && v > 0.985) {
      burstDone = true;
      sweep = 0;
      emit(W - 4, y0, 46, Math.PI, 110, GREEN[1]);
    }

    // частицы
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      p.vy += 26 * dt;
      p.vx *= 1 - dt * 1.8;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      ctx.fillStyle = rgba(p.c, a * 0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    reset() { v = 0; vel = 0; colorMix = 0; burstDone = false; sweep = -1; parts.length = 0; resize(); },
    kick() { vel += 0.35; }, // «толчок» при переходе на новый этап
    finish() { burstDone = false; vel += 0.4; },
  };
})();

// ───────────────────────── источники событий ─────────────────────────
if (window.island && typeof window.island.onEvent === 'function') {
  window.island.onEvent(handle);
}

// Демо: `npm run demo`, index.html?demo=1 в браузере или http://127.0.0.1:47321/test.
const at = (ms, evt) => setTimeout(() => handle({ session: 'demo', cwd: 'C:/Projects/webshop', ts: Date.now(), ...evt }), ms);
function runDemo() {
  {
    at(300, { event: 'UserPromptSubmit', prompt: 'Итог в корзине считает НДС неправильно, исправь и прогони тесты' });
    at(2200, { event: 'PreToolUse', tool: 'Grep', input: { pattern: 'calculateTotal' } });
    at(3600, { event: 'PreToolUse', tool: 'Read', input: { file_path: 'C:/Projects/webshop/src/cart.js' } });
    at(5600, { event: 'PreToolUse', tool: 'Read', input: { file_path: 'C:/Projects/webshop/src/vat.js' } });
    at(7600, { event: 'PreToolUse', tool: 'Edit', input: { file_path: 'C:/Projects/webshop/src/cart.js' } });
    at(9800, { event: 'PreToolUse', tool: 'Edit', input: { file_path: 'C:/Projects/webshop/src/vat.js' } });
    at(12000, { event: 'PreToolUse', tool: 'Bash', input: { command: 'npm test', description: 'Run tests' } });
    at(15500, { event: 'Stop', last: 'Готово! Итог теперь правильно добавляет НДС. Все 48 тестов проходят.' });
  }
}
if (new URLSearchParams(location.search).has('demo')) {
  runDemo();
  setInterval(runDemo, 15500 + HOLD_DONE_MS + FADE_MS + 1500);
}

tickText();
