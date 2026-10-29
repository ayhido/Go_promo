import * as THREE from "/vendor/three/three.module.js";

// ===================================================================
//  3D-сфера в стиле JARVIS: облако частиц, светящееся ядро, орбиты.
//  createOrb(canvas, options) -> { setState, destroy }
//  состояния: idle | listen | think | speak
// ===================================================================

const STATE_COLORS = {
  idle: [0x3fa9f5, 0x9bd7ff],
  listen: [0xff5a5f, 0xffb3b5],
  think: [0xb388ff, 0xe1d0ff],
  speak: [0x3fe0d0, 0xc6fff8]
};

export function createOrb(canvas, { particles = 2200, parallax = true, rings = 3, scale = 1 } = {}) {
  const weak = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 8) <= 4;
  if (weak) particles = Math.round(particles * 0.5);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    canvas.classList.add("no-webgl");
    return { setState() {}, destroy() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, weak ? 1 : 1.5));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 6;

  const group = new THREE.Group();
  group.scale.setScalar(scale);
  scene.add(group);

  // ===== частицы на сфере (спираль Фибоначчи — ровное покрытие) =====
  const base = new Float32Array(particles * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < particles; i++) {
    const y = 1 - (i / (particles - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    const jitter = 1 + (Math.random() - 0.5) * 0.06;
    base[i * 3] = Math.cos(t) * r * 1.6 * jitter;
    base[i * 3 + 1] = y * 1.6 * jitter;
    base[i * 3 + 2] = Math.sin(t) * r * 1.6 * jitter;
  }
  const positions = base.slice();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dotMat = new THREE.PointsMaterial({
    size: 0.028, color: STATE_COLORS.idle[0], transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const dots = new THREE.Points(geo, dotMat);
  group.add(dots);

  // ===== ядро: мягкое свечение из canvas-текстуры =====
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const coreMat = new THREE.SpriteMaterial({ map: glowTex, color: STATE_COLORS.idle[1], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const core = new THREE.Sprite(coreMat);
  core.scale.setScalar(1.6);
  group.add(core);

  // ===== орбиты =====
  const ringMeshes = [];
  for (let i = 0; i < rings; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.05 + i * 0.28, 0.006, 8, 160),
      new THREE.MeshBasicMaterial({ color: STATE_COLORS.idle[0], transparent: true, opacity: 0.45 - i * 0.1, blending: THREE.AdditiveBlending })
    );
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.5;
    ring.rotation.y = i * 0.7;
    group.add(ring);
    ringMeshes.push(ring);
  }

  // ===== состояние и анимация =====
  let state = "idle";
  let energy = 0; // 0..1, сглаженная «громкость»
  const target = new THREE.Color(STATE_COLORS.idle[0]);
  const targetCore = new THREE.Color(STATE_COLORS.idle[1]);
  const mouse = { x: 0, y: 0 };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function onMove(e) {
    const p = e.touches ? e.touches[0] : e;
    mouse.x = (p.clientX / window.innerWidth) * 2 - 1;
    mouse.y = (p.clientY / window.innerHeight) * 2 - 1;
  }
  if (parallax) window.addEventListener("pointermove", onMove, { passive: true });

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return; // вкладка свёрнута — не тратим процессор
    const t = clock.getElapsedTime();
    const speed = reduced ? 0.2 : 1;

    // «голос»: при speak энергия скачет как речь, при listen — мелкая дрожь
    const want =
      state === "speak" ? 0.45 + 0.55 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) :
      state === "listen" ? 0.25 + 0.15 * Math.sin(t * 12) :
      state === "think" ? 0.3 : 0.08;
    energy += (want - energy) * 0.12;

    const pos = geo.attributes.position.array;
    for (let i = 0; i < particles; i++) {
      const k = i * 3;
      const wave = 1 + energy * 0.18 * Math.sin(t * 4 + base[k + 1] * 3 + base[k] * 2);
      pos[k] = base[k] * wave;
      pos[k + 1] = base[k + 1] * wave;
      pos[k + 2] = base[k + 2] * wave;
    }
    geo.attributes.position.needsUpdate = true;

    dots.rotation.y += 0.0025 * speed * (state === "think" ? 3 : 1);
    dots.rotation.x = Math.sin(t * 0.2) * 0.15;
    ringMeshes.forEach((r, i) => { r.rotation.z += (0.003 + i * 0.002) * speed * (state === "think" ? 4 : 1); });
    core.scale.setScalar(1.4 + energy * 1.2 + Math.sin(t * 2) * 0.05);

    dotMat.color.lerp(target, 0.06);
    coreMat.color.lerp(targetCore, 0.06);
    ringMeshes.forEach(r => r.material.color.lerp(target, 0.06));

    group.rotation.y += ((mouse.x * 0.4) - group.rotation.y) * 0.04;
    group.rotation.x += ((mouse.y * 0.25) - group.rotation.x) * 0.04;
    renderer.render(scene, camera);
  }
  frame();

  return {
    setState(next) {
      state = STATE_COLORS[next] ? next : "idle";
      target.setHex(STATE_COLORS[state][0]);
      targetCore.setHex(STATE_COLORS[state][1]);
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
    }
  };
}
