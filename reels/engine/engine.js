// 3D-движок рилса. Всё анимируется только от времени t, поэтому каждый кадр
// можно отрендерить заново и получить ровно то же самое (нужно для покадровой сборки).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const FONT = '"Mont", "Montserrat", Arial, sans-serif';

let W, H, renderer, scene, camera, out, octx, reel, pal, built = [], particles, confetti, bgMat;

// ---------- утилиты ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeBack = (x) => { x = clamp(x); const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const col = (c) => new THREE.Color(c);

// ---------- текст на холсте ----------
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Текстура с текстом: подбирает кегль так, чтобы влезло в maxLines строк.
function textCanvas(text, { width = 1024, size = 96, weight = 900, color = "#fff", maxLines = 3, align = "center", pad = 56, upper = false, badge = null, accent = "#ffd84d" } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const t = upper ? String(text).toUpperCase() : String(text);
  const left = badge != null ? 150 : 0;
  let fs = size, lines;
  for (; fs > 34; fs -= 4) {
    ctx.font = `${weight} ${fs}px ${FONT}`;
    lines = wrapLines(ctx, t, width - pad * 2 - left);
    if (lines.length <= maxLines) break;
  }
  const lh = fs * 1.12;
  c.width = width;
  c.height = Math.max(Math.ceil(lines.length * lh + pad * 1.6), badge != null ? 200 : 0);
  ctx.font = `${weight} ${fs}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.textAlign = align;
  const x = align === "center" ? (width + left) / 2 : pad + left;
  const y0 = c.height / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * lh));
  if (badge != null) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(pad + 56, c.height / 2, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.font = `900 64px ${FONT}`;
    ctx.fillText(String(badge), pad + 56, c.height / 2 + 3);
  }
  return c;
}

function texFrom(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- 3D-примитивы ----------
function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function glossy(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({ color: col(color), metalness: o.metal ?? 0.15, roughness: o.rough ?? 0.22, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: o.irid ?? 0, envMapIntensity: o.env ?? 1.1, transparent: !!o.opacity, opacity: o.opacity ?? 1 });
}

// Карточка: толстая глянцевая плашка + текст на лицевой стороне.
function makeCard(text, o = {}) {
  const w = o.w ?? 3.4;
  const cv = textCanvas(text, { width: 1024, size: o.size ?? 96, color: o.textColor ?? "#fff", maxLines: o.maxLines ?? 3, upper: o.upper ?? false, badge: o.badge, accent: pal.accent, weight: o.weight ?? 900 });
  const h = Math.max(0.7, (w * cv.height) / cv.width);
  const depth = o.depth ?? 0.14;
  const g = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(roundedShape(w, h, Math.min(0.28, h / 2.5)), { depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  const slab = new THREE.Mesh(geo, glossy(o.color ?? pal.card, { rough: 0.3 }));
  g.add(slab);
  const tex = texFrom(cv);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  face.position.z = depth / 2 + 0.056;
  g.add(face);
  g.userData = { w, h, face, tex, cv };
  return g;
}

function setCardText(card, text, o = {}) {
  const cv = textCanvas(text, { width: 1024, size: o.size ?? 150, color: o.textColor ?? "#fff", maxLines: 1, weight: 900 });
  const old = card.userData.tex;
  const tex = texFrom(cv);
  card.userData.face.material.map = tex;
  card.userData.face.material.needsUpdate = true;
  old.dispose();
  card.userData.tex = tex;
}

function extruded(shape, depth, mat, bevel = 0.06) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 24 });
  geo.center();
  return new THREE.Mesh(geo, mat);
}

// Предметы-символы для сцен. Все из примитивов, без внешних моделей.
function makeProp(name, color) {
  const m = glossy(color, { metal: 0.35, rough: 0.12, irid: 0.6 });
  const g = new THREE.Group();
  switch (name) {
    case "house": {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.2), glossy(pal.card2, { rough: 0.3 }));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.85, 4), m);
      roof.position.y = 0.97; roof.rotation.y = Math.PI / 4;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.6, 0.05), glossy(pal.accent));
      door.position.set(0, -0.25, 0.62);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: col("#fff3b0") }));
      win.position.set(0.42, 0.15, 0.62);
      g.add(body, roof, door, win);
      break;
    }
    case "hammer": {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.1, 24), glossy("#c8874a", { rough: 0.45 }));
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.36, 0.36), glossy("#d9dee7", { metal: 0.9, rough: 0.18 }));
      head.position.y = 1.0;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 16), glossy("#d9dee7", { metal: 0.9, rough: 0.18 }));
      claw.rotation.z = Math.PI / 2; claw.position.set(-0.75, 1.0, 0);
      g.add(handle, head, claw);
      g.rotation.z = -0.5;
      break;
    }
    case "drop": {
      const sph = new THREE.Mesh(new THREE.SphereGeometry(0.75, 48, 32), glossy("#4fc3ff", { metal: 0.05, rough: 0.02, irid: 0.3 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.66, 1.05, 48, 1, true), sph.material);
      tip.position.y = 0.88;
      sph.material.transmission = 0.6; sph.material.thickness = 1.2;
      g.add(sph, tip);
      break;
    }
    case "bolt": {
      const s = new THREE.Shape();
      [[0.15, 1.2], [-0.65, -0.1], [-0.05, -0.1], [-0.3, -1.2], [0.65, 0.25], [0.05, 0.25], [0.35, 1.2]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      g.add(extruded(s, 0.35, glossy("#ffd84d", { metal: 0.5, rough: 0.15, irid: 0.4 })));
      break;
    }
    case "heart": {
      const s = new THREE.Shape();
      s.moveTo(0, -0.9);
      s.bezierCurveTo(-1.6, 0.1, -0.9, 1.25, 0, 0.55);
      s.bezierCurveTo(0.9, 1.25, 1.6, 0.1, 0, -0.9);
      g.add(extruded(s, 0.4, glossy("#ff4d6d", { metal: 0.3, rough: 0.12, irid: 0.5 }), 0.12));
      break;
    }
    case "star": {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.48 : 1.1, a = (i / 10) * Math.PI * 2 + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.add(extruded(s, 0.35, glossy("#ffd84d", { metal: 0.6, rough: 0.12, irid: 0.3 }), 0.08));
      break;
    }
    case "clock": {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 24, 80), m);
      const faceM = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 64), glossy("#f4f6fb", { rough: 0.4 }));
      faceM.rotation.x = Math.PI / 2;
      const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.06), glossy("#111"));
      hand1.position.set(0, 0.3, 0.08); hand1.name = "hand1";
      const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.06), glossy(pal.accent));
      hand2.position.set(0, 0.2, 0.1); hand2.name = "hand2";
      const pivot1 = new THREE.Group(); pivot1.add(hand1); pivot1.name = "p1";
      const pivot2 = new THREE.Group(); pivot2.add(hand2); pivot2.name = "p2";
      g.add(ring, faceM, pivot1, pivot2);
      break;
    }
    case "gem":
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 0), m));
      break;
    case "ruble": {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.22, 64), glossy("#ffcc33", { metal: 0.85, rough: 0.2 }));
      coin.rotation.x = Math.PI / 2;
      const cv = textCanvas("₽", { width: 512, size: 300, color: "#7a4d00", maxLines: 1, pad: 10 });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, (1.4 * cv.height) / cv.width), new THREE.MeshBasicMaterial({ map: texFrom(cv), transparent: true }));
      lbl.position.z = 0.12;
      g.add(coin, lbl);
      break;
    }
    default:
      g.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.72, 0.26, 220, 32), m));
  }
  return g;
}

function spinHands(prop, lt) {
  const p1 = prop.getObjectByName("p1"), p2 = prop.getObjectByName("p2");
  if (p1) p1.rotation.z = -lt * 4;
  if (p2) p2.rotation.z = -lt * 0.5 - 1;
}

// ---------- окружение: фон, частицы, конфетти ----------
function makeBackground() {
  bgMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { c1: { value: col(pal.bg1) }, c2: { value: col(pal.bg2) }, c3: { value: col(pal.glow) }, t: { value: 0 }, mood: { value: 0 } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float t; uniform float mood; varying vec3 vP;
      void main(){
        float k = smoothstep(-0.6, 0.7, vP.y);
        vec3 c = mix(c2, c1, k);
        float g = exp(-pow(length(vP.xy - vec2(0.15*sin(t*0.3), 0.25)) * 3.2, 2.0));
        c += c3 * g * 0.22;
        c = mix(c, vec3(0.45,0.04,0.07), mood*0.3*(1.0-k));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 32), bgMat);
  m.renderOrder = -1;
  scene.add(m);
}

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeParticles() {
  const r = rng(7), n = 420, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * 16; pos[i * 3 + 1] = (r() - 0.5) * 22; pos[i * 3 + 2] = -r() * 14 - 1; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.userData.base = pos.slice();
  particles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, map: dotTexture(), color: col(pal.glow), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(particles);
}

function updateParticles(t) {
  const p = particles.geometry.attributes.position, b = particles.geometry.userData.base;
  for (let i = 0; i < p.count; i++) {
    p.array[i * 3] = b[i * 3] + Math.sin(t * 0.4 + i) * 0.15;
    p.array[i * 3 + 1] = ((b[i * 3 + 1] + t * (0.12 + (i % 7) * 0.03) + 11) % 22) - 11;
  }
  p.needsUpdate = true;
}

function makeConfetti() {
  const n = 220, r = rng(42);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.16), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), n);
  const colors = [pal.accent, pal.accent2, "#ffffff", "#7cf2c9", "#ff7ab6", "#ffd84d"];
  const data = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, sp = 3 + r() * 5;
    data.push({ v: new THREE.Vector3(Math.cos(a) * sp * 0.8, 4 + r() * 6, Math.sin(a) * sp * 0.5), w: new THREE.Vector3(r() * 9, r() * 9, r() * 9), o: new THREE.Vector3((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6) });
    mesh.setColorAt(i, col(colors[i % colors.length]));
  }
  mesh.userData.data = data;
  mesh.visible = false;
  confetti = mesh;
  scene.add(mesh);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
function updateConfetti(t) {
  const bursts = (reel.bursts || []).filter((b) => t >= b && t < b + 3.2);
  if (!bursts.length) { confetti.visible = false; return; }
  const lt = t - bursts[bursts.length - 1];
  confetti.visible = true;
  confetti.userData.data.forEach((d, i) => {
    _p.set(d.o.x + d.v.x * lt, 0.9 + d.v.y * lt - 4.9 * lt * lt, 1.5 + d.o.z + d.v.z * lt);
    _e.set(d.w.x * lt, d.w.y * lt, d.w.z * lt);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    confetti.setMatrixAt(i, _m);
  });
  confetti.instanceMatrix.needsUpdate = true;
}

// ---------- сцены ----------
// Каждая сцена: group + update(lt, dur). lt — время от начала сцены.
const SCENES = {
  hook(s) {
    const g = new THREE.Group();
    const prop = makeProp(s.prop || "knot", pal.accent);
    prop.position.set(0, 3.65, -1.2);
    prop.scale.setScalar(1.15);
    const card = makeCard(s.title, { size: 118, upper: true, color: pal.card, maxLines: 3 });
    card.position.set(0, 1.6, 0.6);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.035, 16, 120), new THREE.MeshBasicMaterial({ color: col(pal.accent2), toneMapped: false }));
    ring.position.copy(prop.position);
    g.add(prop, card, ring);
    return {
      group: g,
      update(lt) {
        prop.rotation.y = lt * 1.2;
        spinHands(prop, lt);
        prop.rotation.x = Math.sin(lt * 0.9) * 0.35;
        prop.position.y = 3.65 + Math.sin(lt * 2) * 0.08;
        const pop = easeBack(lt / 0.55);
        card.scale.setScalar(lerp(0.4, 1, pop));
        card.rotation.y = Math.sin(lt * 1.3) * 0.12 + (1 - pop) * 0.9;
        card.rotation.x = Math.sin(lt * 0.9) * 0.05;
        ring.rotation.x = 1.2 + Math.sin(lt) * 0.2;
        ring.rotation.y = lt * 0.8;
        ring.scale.setScalar(1 + 0.04 * Math.sin(lt * 6));
      }
    };
  },

  problem(s) {
    const g = new THREE.Group();
    const r = rng(s.seed || 3);
    const cubes = [];
    for (let i = 0; i < 36; i++) {
      const sz = 0.15 + r() * 0.3;
      const c = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), glossy(i % 3 ? pal.card2 : "#ff4d4d", { rough: 0.3 }));
      c.userData = { x: (r() - 0.5) * 7, y0: 6 + r() * 6, z: -2 - r() * 6, sp: 1 + r() * 1.6, w: r() * 4 };
      cubes.push(c); g.add(c);
    }
    const prop = makeProp(s.prop || "drop", "#ff5a5a");
    prop.position.set(0, 3.6, -0.8);
    const card = makeCard(s.title, { size: 104, color: "#2a0f17", maxLines: 3 });
    card.position.set(0, 1.6, 0.6);
    g.add(prop, card);
    return {
      group: g,
      mood: 1,
      update(lt) {
        cubes.forEach((c) => { const u = c.userData; c.position.set(u.x, ((u.y0 - lt * u.sp) % 12 + 12) % 12 - 5, u.z); c.rotation.set(lt * u.w, lt * u.w * 0.7, 0); });
        const shake = Math.max(0, 1 - lt / 0.6);
        prop.rotation.y = Math.sin(lt * 0.9) * 0.6;
        spinHands(prop, lt);
        prop.rotation.z = Math.sin(lt * 18) * 0.1 * shake + Math.sin(lt * 1.5) * 0.15;
        prop.position.y = 3.6 + Math.sin(lt * 2.4) * 0.1;
        card.scale.setScalar(lerp(0.5, 1, easeBack(lt / 0.5)));
        card.position.x = Math.sin(lt * 40) * 0.05 * shake;
        card.rotation.y = Math.sin(lt * 1.1) * 0.1;
      }
    };
  },

  solution(s) {
    const g = new THREE.Group();
    const r = rng(s.seed || 5);
    const blocks = [];
    const grid = [];
    for (let x = -2; x <= 2; x++) for (let y = 0; y < 4; y++) if (Math.abs(x) + y < 5) grid.push([x * 0.5, y * 0.5]);
    grid.forEach(([gx, gy], i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), glossy(i % 4 === 0 ? pal.accent : pal.card2, { rough: 0.2, metal: 0.2 }));
      b.userData = { from: new THREE.Vector3((r() - 0.5) * 10, (r() - 0.5) * 12, -3 - r() * 8), to: new THREE.Vector3(gx, 2.75 + gy, -2.2), d: r() * 0.5 };
      blocks.push(b); g.add(b);
    });
    const card = makeCard(s.title, { size: 104, color: pal.card, maxLines: 3 });
    card.position.set(0, 1.55, 0.7);
    const check = makeProp(s.prop || "star", pal.accent);
    check.scale.setScalar(0.45);
    check.position.set(1.5, 1.6 + card.userData.h / 2, 1.1);
    g.add(card, check);
    return {
      group: g,
      update(lt) {
        blocks.forEach((b) => { const u = b.userData; const k = easeInOut((lt - u.d) / 1.1); b.position.lerpVectors(u.from, u.to, k); b.rotation.set((1 - k) * 6, (1 - k) * 4 + lt * 0.2, 0); });
        g.children.forEach((c) => { if (blocks.includes(c)) c.position.x += Math.sin(lt * 0.6) * 0.0; });
        card.scale.setScalar(lerp(0.5, 1, easeBack((lt - 0.15) / 0.5)));
        card.rotation.y = Math.sin(lt * 1.2) * 0.1;
        const cp = easeBack((lt - 0.6) / 0.4);
        check.scale.setScalar(0.45 * cp);
        check.rotation.y = lt * 2;
      }
    };
  },

  steps(s) {
    const g = new THREE.Group();
    const items = (s.items || []).slice(0, 4);
    const cards = items.map((it, i) => makeCard(it, { size: 76, badge: i + 1, color: pal.card, maxLines: 2, w: 3.5, depth: 0.1 }));
    let title = null;
    if (s.title) { title = makeCard(s.title, { size: 92, upper: true, color: pal.accentCard, maxLines: 2, w: 3.3 }); g.add(title); }
    const gap = 0.16;
    const total = cards.reduce((a, c) => a + c.userData.h, 0) + gap * (cards.length - 1);
    let y = (title ? 2.45 : 2.75) + total / 2;
    if (title) title.position.set(0, Math.min(4.45, y + title.userData.h / 2 + 0.25), 0.4);
    cards.forEach((c) => { c.userData.y = y - c.userData.h / 2; y -= c.userData.h + gap; g.add(c); });
    return {
      group: g,
      update(lt, dur) {
        if (title) { title.scale.setScalar(lerp(0.5, 1, easeBack(lt / 0.45))); title.rotation.y = Math.sin(lt) * 0.06; }
        const span = Math.max(0.4, (dur - 0.8) / Math.max(1, cards.length));
        cards.forEach((c, i) => {
          const k = easeBack((lt - 0.25 - i * span) / 0.45);
          c.visible = k > 0.001;
          c.position.set(lerp(5, 0, k), c.userData.y, 0.5);
          c.rotation.y = lerp(-1.1, 0, k) + Math.sin(lt * 1.3 + i) * 0.06;
          c.rotation.z = (1 - k) * 0.3;
        });
      }
    };
  },

  stat(s) {
    const g = new THREE.Group();
    const target = Number(s.number) || 0;
    const card = makeCard(`${s.prefix || ""}0${s.suffix || ""}`, { size: 150, color: pal.card, maxLines: 1, w: 3.4 });
    card.position.set(0, 3.0, 0.4);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 24, 160), glossy(pal.accent, { metal: 0.6, rough: 0.12, irid: 0.8 }));
    ring.position.set(0, 3.0, -1.2);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.03, 12, 160), new THREE.MeshBasicMaterial({ color: col(pal.accent2), toneMapped: false }));
    ring2.position.copy(ring.position);
    let sub = null;
    if (s.title) { sub = makeCard(s.title, { size: 80, color: pal.accentCard, maxLines: 2, w: 3.3, depth: 0.08 }); sub.position.set(0, 1.35, 0.8); g.add(sub); }
    g.add(card, ring, ring2);
    let last = null;
    return {
      group: g,
      update(lt) {
        const k = easeOut((lt - 0.2) / 1.3);
        const val = Math.round(target * k);
        const txt = `${s.prefix || ""}${val.toLocaleString("ru-RU")}${s.suffix || ""}`;
        if (txt !== last) { setCardText(card, txt); last = txt; }
        card.scale.setScalar(lerp(0.4, 1, easeBack(lt / 0.5)) * (1 + 0.04 * Math.max(0, 1 - Math.abs(lt - 1.5) * 4)));
        card.rotation.y = Math.sin(lt * 1.1) * 0.12;
        ring.rotation.set(0.25 + Math.sin(lt * 0.7) * 0.15, Math.sin(lt * 0.9) * 0.3, lt * 0.5);
        ring2.rotation.set(0.4 + Math.sin(lt) * 0.2, -0.3, -lt * 0.4);
        if (sub) sub.scale.setScalar(lerp(0.4, 1, easeBack((lt - 0.5) / 0.45)));
      }
    };
  },

  cta(s) {
    const g = new THREE.Group();
    const pw = 2.3, ph = 3.5;
    const phone = new THREE.Group();
    const bodyGeo = new THREE.ExtrudeGeometry(roundedShape(pw, ph, 0.32), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5, curveSegments: 12 });
    bodyGeo.translate(0, 0, -0.08);
    phone.add(new THREE.Mesh(bodyGeo, glossy("#15161c", { metal: 0.7, rough: 0.2 })));
    const sc = document.createElement("canvas");
    sc.width = 640; sc.height = Math.round((640 * ph) / pw);
    const x = sc.getContext("2d");
    const gr = x.createLinearGradient(0, 0, 0, sc.height);
    gr.addColorStop(0, pal.bg1); gr.addColorStop(1, pal.bg2);
    x.fillStyle = gr; roundRect(x, 0, 0, sc.width, sc.height, 70); x.fill();
    x.fillStyle = pal.accent; x.beginPath(); x.arc(320, 230, 110, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#111"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `900 110px ${FONT}`; x.fillText((reel.brand?.name || "G")[0].toUpperCase(), 320, 236);
    x.fillStyle = "#fff"; x.font = `800 50px ${FONT}`; x.fillText(reel.brand?.name || "", 320, 410);
    x.fillStyle = "rgba(255,255,255,.7)"; x.font = `600 38px ${FONT}`; x.fillText(reel.brand?.handle || "", 320, 470);
    const btn = (y, label, fill, color) => { x.fillStyle = fill; roundRect(x, 70, y, 500, 110, 55); x.fill(); x.fillStyle = color; let f = 44; x.font = `900 ${f}px ${FONT}`; while (x.measureText(label).width > 440 && f > 24) { f -= 2; x.font = `900 ${f}px ${FONT}`; } x.fillText(label, 320, y + 57); };
    btn(560, "ПОДПИСАТЬСЯ", pal.accent, "#111");
    btn(700, s.button || "НАПИСАТЬ", "rgba(255,255,255,.14)", "#fff");
    x.fillStyle = "rgba(255,255,255,.85)"; x.font = `800 46px ${FONT}`;
    wrapLines(x, s.title || "", 520).slice(0, 3).forEach((l, i) => x.fillText(l, 320, 880 + i * 56));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.12, ph - 0.12), new THREE.MeshBasicMaterial({ map: texFrom(sc), toneMapped: false }));
    screen.position.z = 0.14;
    phone.add(screen);
    phone.position.set(0, 2.75, 0.2);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.05, 16, 160), new THREE.MeshBasicMaterial({ color: col(pal.accent), toneMapped: false, transparent: true }));
    halo.position.set(0, 2.75, -0.6);
    const heart = makeProp("heart", "#ff4d6d");
    heart.scale.setScalar(0.42);
    heart.position.set(1.45, 4.25, 1);
    g.add(phone, halo, heart);
    return {
      group: g,
      update(lt) {
        const k = easeBack(lt / 0.8);
        phone.rotation.y = lerp(Math.PI * 0.9, 0, k) + Math.sin(lt * 1.2) * 0.12;
        phone.rotation.x = Math.sin(lt * 0.8) * 0.05;
        phone.scale.setScalar(lerp(0.6, 1, k));
        const p = (lt * 1.2) % 1;
        halo.scale.setScalar(1 + p * 0.25);
        halo.material.opacity = 1 - p;
        heart.rotation.y = lt * 2.2;
        heart.scale.setScalar(0.42 * (1 + 0.12 * Math.max(0, Math.sin(lt * 7))));
      }
    };
  }
};

// ---------- субтитры (слово за словом, как в живых рилсах) ----------
function buildChunks(words) {
  const chunks = [];
  let cur = [];
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; };
  for (const w of words) {
    cur.push(w);
    const len = cur.map((x) => x.w).join(" ").length;
    if (cur.length >= 3 || len > 16 || /[.!?,:;…—]$/.test(w.w)) flush();
  }
  flush();
  return chunks.map((c, i) => ({ words: c, start: c[0].t, end: i + 1 < chunks.length ? Math.min(chunks[i + 1][0].t, c[c.length - 1].t + c[c.length - 1].d + 0.6) : c[c.length - 1].t + c[c.length - 1].d + 0.5 }));
}

function drawCaptions(t) {
  const ch = reel._chunks.find((c) => t >= c.start && t < c.end);
  if (!ch) return;
  const pop = easeBack((t - ch.start) / 0.14);
  const baseY = H * 0.735;
  let fs = 84;
  const clean = (w) => w.replace(/[,;:]$/, "").toUpperCase();
  octx.font = `900 ${fs}px ${FONT}`;
  const space = fs * 0.45;
  let widths = ch.words.map((w) => octx.measureText(clean(w.w)).width);
  let total = widths.reduce((a, b) => a + b, 0) + space * (ch.words.length - 1);
  if (total > W * 0.86) { fs = Math.floor(fs * (W * 0.86) / total); octx.font = `900 ${fs}px ${FONT}`; widths = ch.words.map((w) => octx.measureText(clean(w.w)).width); total = widths.reduce((a, b) => a + b, 0) + fs * 0.45 * (ch.words.length - 1); }
  octx.save();
  octx.translate(W / 2, baseY);
  octx.scale(lerp(0.7, 1, pop), lerp(0.7, 1, pop));
  octx.textBaseline = "middle";
  octx.lineJoin = "round";
  let x = -total / 2;
  ch.words.forEach((w, i) => {
    const active = t >= w.t && (i + 1 < ch.words.length ? t < ch.words[i + 1].t : true);
    const txt = clean(w.w);
    octx.save();
    octx.translate(x + widths[i] / 2, 0);
    if (active) octx.scale(1.08, 1.08);
    octx.textAlign = "center";
    octx.lineWidth = fs * 0.2;
    octx.strokeStyle = "rgba(0,0,0,.92)";
    octx.shadowColor = "rgba(0,0,0,.5)"; octx.shadowBlur = 18; octx.shadowOffsetY = 6;
    octx.strokeText(txt, 0, 0);
    octx.shadowColor = "transparent";
    octx.fillStyle = active ? pal.caption : "#ffffff";
    octx.fillText(txt, 0, 0);
    octx.restore();
    x += widths[i] + fs * 0.45;
  });
  octx.restore();
}

function drawOverlay(t) {
  // виньетка
  const g = octx.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.5)");
  octx.fillStyle = g; octx.fillRect(0, 0, W, H);
  // вспышка на склейке
  for (const s of reel.scenes) {
    const d = t - s.start;
    if (s.start > 0 && d >= 0 && d < 0.16) { octx.fillStyle = `rgba(255,255,255,${0.28 * (1 - d / 0.16)})`; octx.fillRect(0, 0, W, H); }
  }
  // подпись автора
  if (reel.brand?.handle) {
    octx.font = `800 34px ${FONT}`;
    octx.textAlign = "right"; octx.textBaseline = "middle";
    octx.fillStyle = "rgba(255,255,255,.85)";
    octx.shadowColor = "rgba(0,0,0,.6)"; octx.shadowBlur = 8;
    octx.fillText(reel.brand.handle.toUpperCase(), W - 60, 210);
    octx.shadowColor = "transparent";
  }
  drawCaptions(t);
}

// ---------- публичное API для рендера ----------
window.setup = async function (spec) {
  reel = spec;
  W = spec.width; H = spec.height;
  pal = spec.palette;
  await Promise.all(["900", "800", "600"].map((w) => document.fonts.load(`${w} 40px Mont`, "Привет Hello")));
  await document.fonts.ready;

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);

  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 6, 8); scene.add(key);
  const rim1 = new THREE.PointLight(col(pal.accent), 40, 30); rim1.position.set(-4, 4, 2); scene.add(rim1);
  const rim2 = new THREE.PointLight(col(pal.accent2), 40, 30); rim2.position.set(4, 0, 3); scene.add(rim2);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  scene.userData.rims = [rim1, rim2];

  makeBackground();
  makeParticles();
  makeConfetti();

  built = spec.scenes.map((s, i) => {
    const b = (SCENES[s.type] || SCENES.hook)({ ...s, seed: i + 11 });
    b.group.visible = false;
    scene.add(b.group);
    return { ...b, s };
  });
  reel._chunks = buildChunks(spec.words || []);

  out = document.createElement("canvas");
  out.width = W; out.height = H;
  octx = out.getContext("2d");
  document.body.appendChild(out);
  return true;
};

function renderAt(t) {
  bgMat.uniforms.t.value = t;
  updateParticles(t);
  updateConfetti(t);
  let mood = 0;
  for (const b of built) {
    const { start, end } = b.s;
    const on = t >= start - 0.001 && t < end + 0.3;
    b.group.visible = on;
    if (!on) continue;
    const lt = t - start, dur = end - start;
    b.update(Math.max(0, lt), dur);
    // вход: прилетает из глубины; выход: улетает на камеру
    const enter = easeOut(lt / 0.45);
    const exit = easeInOut((t - (end - 0.22)) / 0.5);
    b.group.position.set(0, 0, lerp(-7, 0, enter) + exit * 12);
    b.group.rotation.set(exit * -0.4, (1 - enter) * 0.5, 0);
    b.group.scale.setScalar(lerp(0.7, 1, enter));
    if (t >= start && t < end) mood = b.mood || 0;
  }
  bgMat.uniforms.mood.value = mood;
  // «живая» камера: лёгкое дыхание и медленный наезд
  camera.position.set(Math.sin(t * 0.7) * 0.18, 2.3 + Math.sin(t * 0.9) * 0.08, 11 - Math.min(1.2, t * 0.04));
  camera.lookAt(0, 2.3, 0);
  scene.userData.rims[0].intensity = 40 + Math.sin(t * 2) * 10;
  renderer.render(scene, camera);
  octx.clearRect(0, 0, W, H);
  octx.drawImage(renderer.domElement, 0, 0);
  drawOverlay(t);
}

window.frame = function (t, quality = 0.9) {
  renderAt(t);
  return out.toDataURL("image/jpeg", quality);
};

window.ready = true;
