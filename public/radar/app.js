// ===== Радар заработка: клиент =====
const $ = s => document.querySelector(s);
const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let state = null;
let tab = "feed";
let category = "";
let items = [];

const getKey = () => {
  try {
    return localStorage.getItem("radarKey") || "";
  } catch {
    return "";
  }
};

async function api(path, opts = {}) {
  const res = await fetch("/api/radar" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-radar-key": getKey(), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    askPassword();
    throw new Error("Нужен пароль");
  }
  if (!res.ok) throw new Error(data.error || "Ошибка " + res.status);
  return data;
}

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.style.display = "none"), ms);
}

function askPassword() {
  const p = prompt("Пароль радара (RADAR_PASSWORD):");
  if (p != null) {
    try {
      localStorage.setItem("radarKey", p);
    } catch {}
    location.reload();
  }
}

const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} д назад`;
};
const scoreColor = s => (s >= 70 ? "var(--good)" : s >= 50 ? "var(--accent)" : s >= 30 ? "#9fb0d8" : "#5d6789");

// ---------- состояние ----------
async function loadState() {
  state = await api("/state");
  const st = state;
  $("#status").textContent =
    `${st.total} находок · ${st.lastRun ? "обновлено " + ago(st.lastRun) : "первый сбор…"}` +
    (st.running ? " · идёт сбор" : "") +
    ` · ИИ ${st.ai ? "вкл" : "выкл"}`;
  const chips = [["", "Все", st.total], ...Object.entries(st.categories).map(([k, v]) => [k, v, st.counts[k] || 0])];
  $("#chips").innerHTML = chips
    .map(([k, v, n]) => `<button class="chip ${k === category ? "on" : ""}" data-cat="${k}">${esc(v)} · ${n}</button>`)
    .join("");
}

$("#chips").onclick = e => {
  const b = e.target.closest(".chip");
  if (!b) return;
  category = b.dataset.cat;
  document.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c === b));
  loadList();
};

// ---------- лента ----------
function card(i) {
  const title = i.titleRu || i.title;
  const earn = i.ai?.how_to_earn || "";
  return `<div class="card" data-key="${i.key}">
    <div class="meta">
      <span class="score" style="background:${scoreColor(i.score)}">${i.score}</span>
      <span class="cat">${esc(state.categories[i.category] || i.category)}</span>
      <span>${esc(i.source)}</span><span>${ago(i.publishedAt)}</span>
      ${i.starred ? "<span>⭐</span>" : ""}${i.video ? '<span class="tag">видео</span>' : ""}${i.published ? '<span class="tag ok">в Instagram</span>' : ""}
      ${i.matched.map(m => `<span class="tag">${esc(m)}</span>`).join("")}
    </div>
    <h3>${esc(title)}</h3>
    ${earn ? `<p class="earn">💰 ${esc(earn.length > 220 ? earn.slice(0, 217) + "…" : earn)}</p>` : `<p class="earn small">${esc(i.summary.slice(0, 160))}</p>`}
    ${i.risk ? `<div class="risk">⚠️ ${esc(i.risk)}</div>` : ""}
  </div>`;
}

async function loadList() {
  const params = new URLSearchParams({ sort: $("#sort").value, limit: 150 });
  if (category) params.set("category", category);
  if ($("#q").value.trim()) params.set("q", $("#q").value.trim());
  if (tab === "starred") params.set("starred", "1");
  items = await api("/items?" + params);
  $("#list").innerHTML = items.length
    ? items.map(card).join("")
    : `<div class="empty">${tab === "starred" ? "Отмечайте ⭐ интересное — оно появится здесь" : state?.lastRun ? "Ничего не найдено" : "Идёт первый сбор, это займёт около минуты…"}</div>`;
}

let qTimer;
$("#q").oninput = () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(loadList, 300);
};
$("#sort").onchange = loadList;
$("#list").onclick = e => {
  const c = e.target.closest(".card");
  if (c) openItem(c.dataset.key);
};

$("#refresh").onclick = async () => {
  toast("Собираю свежие данные…");
  try {
    const r = await api("/refresh", { method: "POST" });
    toast(`Новых: ${r.found}, уведомлений: ${r.notified}`);
    await loadState();
    await reloadTab();
  } catch (e) {
    toast(e.message);
  }
};

// ---------- карточка ----------
async function openItem(key) {
  const i = await api("/items/" + key);
  history.replaceState(null, "", "#item=" + key);
  renderItem(i);
  $("#sheet").classList.add("open");
}

function closeSheet() {
  $("#sheet").classList.remove("open");
  history.replaceState(null, "", location.pathname);
}
$("#sheet").onclick = e => {
  if (e.target.id === "sheet") closeSheet();
};

function renderItem(i) {
  const r = i.reel;
  const ig = state.instagram;
  $("#sheetBody").innerHTML = `
    <div class="row" style="justify-content:space-between;margin-top:0">
      <button class="btn" data-a="close">✕ Закрыть</button>
      <button class="btn" data-a="star">${i.starred ? "★ В избранном" : "☆ В избранное"}</button>
    </div>
    <div class="meta">
      <span class="score" style="background:${scoreColor(i.score)}">${i.score}</span>
      <span class="cat">${esc(state.categories[i.category])}</span><span>${esc(i.source)}</span><span>${ago(i.publishedAt)}</span>
    </div>
    <h2>${esc(i.titleRu || i.title)}</h2>
    ${i.titleRu ? `<div class="small">${esc(i.title)}</div>` : ""}
    ${i.summary ? `<p class="small">${esc(i.summary)}</p>` : ""}
    <div class="row"><a class="btn" href="${esc(i.url)}" target="_blank" rel="noopener">Открыть источник ↗</a>
      ${state.ai ? `<button class="btn" data-a="analyze">🧠 ${i.ai ? "Разобрать заново" : "Как на этом заработать?"}</button>` : ""}</div>
    ${i.risk ? `<div class="risk">⚠️ ${esc(i.risk)}</div>` : ""}
    ${
      i.ai
        ? `<div class="box"><h4>Как заработать</h4><p style="margin:0">${esc(i.ai.how_to_earn)}</p>
        <ol>${i.ai.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
        <div class="small">Старт: ${esc(i.ai.start_cost)} · Сложность: ${esc(i.ai.difficulty)}</div>
        ${i.ai.risk ? `<div class="risk">${esc(i.ai.risk)}</div>` : ""}</div>`
        : ""
    }
    <div class="box"><h4>Рилс ${r.by === "ai" ? "· сценарий ИИ" : r.by === "you" ? "· ваш сценарий" : "· шаблон"}</h4>
      <label class="f">Крючок (первые 2 секунды)</label><input type="text" id="r-hook" value="${esc(r.hook)}">
      <label class="f">Текст на экране — по строке на слайд</label><textarea id="r-slides" rows="5">${esc(r.slides.join("\n"))}</textarea>
      <label class="f">Призыв в конце</label><input type="text" id="r-cta" value="${esc(r.cta)}">
      <label class="f">Подпись к публикации</label><textarea id="r-caption" rows="4">${esc(r.caption)}</textarea>
      <label class="f">Хэштеги</label><input type="text" id="r-tags" value="${esc((r.hashtags || []).join(" "))}">
      ${r.shooting ? `<label class="f">Как снять самому</label><div class="small">${esc(r.shooting)}</div>` : ""}
      <div class="row">
        <button class="btn" data-a="saveReel">💾 Сохранить</button>
        <button class="btn primary" data-a="video" ${state.video.ffmpeg ? "" : "disabled"}>🎬 ${i.video ? "Пересобрать видео" : "Собрать видео"}</button>
        <button class="btn" data-a="copy">📋 Копировать подпись</button>
      </div>
      ${state.video.ffmpeg ? "" : '<div class="small">На сервере нет ffmpeg — видео не собрать, но сценарий можно снять самому.</div>'}
      ${
        i.video
          ? `<video src="${esc(i.video)}" controls playsinline preload="metadata"></video>
        <div class="row"><a class="btn" href="${esc(i.video)}" download>⬇️ Скачать</a>
        <button class="btn primary" data-a="publish" ${ig.ready && !i.published ? "" : "disabled"}>📲 Опубликовать в Instagram</button></div>`
          : ""
      }
      ${i.published ? `<div class="ok">Опубликовано ${ago(i.published.at)} ${i.published.permalink ? `· <a href="${esc(i.published.permalink)}" target="_blank" rel="noopener">открыть</a>` : ""}</div>` : ""}
      ${i.publishError ? `<div class="risk">Ошибка публикации: ${esc(i.publishError)}</div>` : ""}
      ${!ig.ready ? `<div class="small">Для публикации в Instagram задайте на сервере: ${esc(ig.missing.join(", "))}.</div>` : ""}
    </div>`;

  $("#sheetBody").onclick = async e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const btn = e.target.closest("button");
    const busy = text => {
      if (btn) {
        btn.disabled = true;
        btn.textContent = text;
      }
    };
    try {
      if (a === "close") return closeSheet();
      if (a === "star") renderItem(await api("/items/" + i.key, { method: "PATCH", body: { starred: !i.starred } }));
      if (a === "copy") {
        await navigator.clipboard.writeText(`${$("#r-caption").value}\n\n${$("#r-tags").value}`);
        toast("Подпись скопирована");
      }
      if (a === "analyze") {
        busy("Думаю…");
        renderItem(await api(`/items/${i.key}/analyze`, { method: "POST" }));
      }
      if (a === "saveReel" || a === "video") {
        await api("/items/" + i.key, {
          method: "PATCH",
          body: {
            reel: {
              hook: $("#r-hook").value,
              slides: $("#r-slides").value.split("\n").map(s => s.trim()).filter(Boolean),
              cta: $("#r-cta").value,
              caption: $("#r-caption").value,
              hashtags: $("#r-tags").value.split(/\s+/).filter(Boolean),
              shooting: r.shooting || ""
            }
          }
        });
        if (a === "saveReel") toast("Сохранено");
        if (a === "video") {
          busy("Собираю видео…");
          renderItem(await api(`/items/${i.key}/video`, { method: "POST" }));
          toast("Видео готово");
        }
      }
      if (a === "publish") {
        if (!confirm("Опубликовать этот рилс в Instagram?")) return;
        busy("Публикую… до 3 минут");
        renderItem(await api(`/items/${i.key}/publish`, { method: "POST" }));
        toast("Опубликовано в Instagram");
      }
    } catch (err) {
      toast(err.message, 5000);
      renderItem(await api("/items/" + i.key).catch(() => i));
    }
  };
}

// ---------- рилсы ----------
async function loadReels() {
  const all = await api("/items?sort=score&limit=300");
  const withVideo = all.filter(i => i.video || i.published);
  const ideas = all.filter(i => !i.video && i.reel.by !== "rules" && i.score >= 50).slice(0, 15);
  $("#reels").innerHTML =
    `<div class="box"><h4>Готовые видео</h4>${
      withVideo.length
        ? withVideo.map(card).join("")
        : '<div class="small">Пока нет. Откройте находку и нажмите «Собрать видео».</div>'
    }</div>
    <div class="box"><h4>Что снять сегодня</h4>${
      ideas.length ? ideas.map(card).join("") : '<div class="small">Сценарии от ИИ появятся, когда на сервере задан ANTHROPIC_API_KEY.</div>'
    }</div>`;
}
$("#reels").onclick = e => {
  const c = e.target.closest(".card");
  if (c) openItem(c.dataset.key);
};

// ---------- push ----------
const b64 = s => {
  const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p), c => c.charCodeAt(0));
};
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

async function pushSub() {
  const reg = await navigator.serviceWorker?.getRegistration("/radar/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error(
      isIos && !standalone
        ? "На iPhone: Поделиться → «На экран Домой», затем откройте радар с иконки и включите уведомления"
        : "Этот браузер не поддерживает push. Используйте Chrome или установите приложение на экран"
    );
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Уведомления запрещены в настройках браузера");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(state.vapidPublicKey) });
  await api("/push/subscribe", { method: "POST", body: sub.toJSON() });
}

// ---------- настройки ----------
async function renderSettings() {
  await loadState();
  const s = state.settings;
  const sub = await pushSub().catch(() => null);
  const yes = (v, t = "есть") => (v ? `<span class="ok">${t}</span>` : `<span class="no">нет</span>`);
  const src = Object.values(state.sources)
    .map(x => `<div class="sw"><span>${esc(x.name)}</span><span class="${x.ok ? "ok" : "no"} small">${x.ok ? x.count + " шт" : esc(x.error)}</span></div>`)
    .join("");
  $("#tab-settings").innerHTML = `
    <div class="box"><h4>Уведомления на телефон</h4>
      <div class="sw"><span>Push на это устройство</span><span>${yes(sub, "включены")}</span></div>
      <div class="row">
        <button class="btn primary" data-a="push">${sub ? "Переподключить" : "🔔 Включить уведомления"}</button>
        <button class="btn" data-a="test">Проверить</button>
      </div>
      ${isIos && !standalone ? '<div class="small">iPhone: нажмите «Поделиться» → «На экран Домой», откройте радар с иконки и включите уведомления здесь.</div>' : ""}
      <div class="sw"><span>Telegram</span><span>${yes(state.telegram, "подключён")}</span></div>
      <label class="f">Присылать, если оценка не ниже: <b id="minv">${s.minScore}</b></label>
      <input type="range" id="minScore" min="20" max="95" step="5" value="${s.minScore}" style="width:100%">
      <label class="f">Без уведомлений по разделам</label>
      <div class="chips" id="muted">${Object.entries(state.categories)
        .map(([k, v]) => `<button class="chip ${s.mutedCategories.includes(k) ? "on" : ""}" data-m="${k}">${esc(v)}</button>`)
        .join("")}</div>
    </div>

    <div class="box"><h4>Мои темы</h4>
      <div class="small">Через запятую. Находки с этими словами поднимаются выше и чаще приходят в уведомления.</div>
      <input type="text" id="keywords" value="${esc(s.keywords.join(", "))}" placeholder="маркетплейс, ИИ, кофейня, недвижимость">
    </div>

    <div class="box"><h4>Instagram</h4>
      <div class="sw"><span>Сборка видео (ffmpeg)</span><span>${yes(state.video.ffmpeg)}</span></div>
      <div class="sw"><span>Доступ к Instagram API</span><span>${state.instagram.ready ? '<span class="ok">настроен</span>' : `<span class="no small">нет ${esc(state.instagram.missing.join(", "))}</span>`}</span></div>
      <label class="f">Подпись внизу видео</label><input type="text" id="brand" value="${esc(s.brand)}" placeholder="@ваш_ник">
      <div class="sw"><span>Автопубликация лучших рилсов</span><input type="checkbox" id="autopublish" ${s.autopublish ? "checked" : ""}></div>
      <label class="f">Рилсов в сутки (опубликовано за 24 ч: ${state.publishedToday})</label>
      <input type="number" id="perDay" min="1" max="10" value="${s.autopublishPerDay}">
      <label class="f">Минимальная оценка для автопубликации</label>
      <input type="number" id="apMin" min="0" max="100" value="${s.autopublishMinScore}">
      <div class="small">Автопубликация берёт свежую находку с высокой оценкой без признаков риска, собирает видео и публикует. Новости и тренды не публикуются автоматически.</div>
    </div>

    <div class="row"><button class="btn primary" data-a="save">💾 Сохранить настройки</button></div>

    <div class="box"><h4>Система</h4>
      <div class="sw"><span>ИИ-разбор (Claude)</span><span>${yes(state.ai, "включён")}</span></div>
      <div class="sw"><span>Прокси</span><span>${yes(state.proxy, "используется")}</span></div>
      <div class="sw"><span>Обход источников</span><span class="small">каждые ${state.intervalMin} мин</span></div>
      <div class="sw"><span>Подписанных устройств</span><span class="small">${state.subscribers}</span></div>
    </div>
    <div class="box"><h4>Источники</h4>${src || '<div class="small">Ещё не опрашивались</div>'}</div>
    <div class="row"><button class="btn" data-a="pass">🔑 Пароль доступа</button></div>`;

  $("#minScore").oninput = e => ($("#minv").textContent = e.target.value);
  $("#muted").onclick = e => e.target.closest(".chip")?.classList.toggle("on");
  $("#tab-settings").onclick = async e => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    try {
      if (a === "push") {
        await enablePush();
        toast("Уведомления включены");
        renderSettings();
      }
      if (a === "test") {
        const r = await api("/push/test", { method: "POST" });
        toast(r.subscribers ? "Отправлено — проверьте уведомление" : "Нет подписанных устройств");
      }
      if (a === "pass") askPassword();
      if (a === "save") {
        await api("/settings", {
          method: "PUT",
          body: {
            minScore: Number($("#minScore").value),
            mutedCategories: [...document.querySelectorAll("#muted .chip.on")].map(c => c.dataset.m),
            keywords: $("#keywords").value.split(","),
            brand: $("#brand").value,
            autopublish: $("#autopublish").checked,
            autopublishPerDay: Number($("#perDay").value),
            autopublishMinScore: Number($("#apMin").value)
          }
        });
        toast("Сохранено");
      }
    } catch (err) {
      toast(err.message, 6000);
    }
  };
}

// ---------- вкладки ----------
async function reloadTab() {
  if (tab === "feed" || tab === "starred") await loadList();
  if (tab === "reels") await loadReels();
  if (tab === "settings") await renderSettings();
}

document.querySelector("nav").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  $("#tab-feed").classList.toggle("hide", !(tab === "feed" || tab === "starred"));
  $("#tab-reels").classList.toggle("hide", tab !== "reels");
  $("#tab-settings").classList.toggle("hide", tab !== "settings");
  $("#feedTools").classList.toggle("hide", !(tab === "feed" || tab === "starred"));
  scrollTo(0, 0);
  reloadTab().catch(err => toast(err.message));
};

function openFromHash() {
  const m = location.hash.match(/item=([0-9a-f]+)/);
  if (m) openItem(m[1]).catch(() => {});
}
addEventListener("hashchange", openFromHash);

(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/radar/sw.js", { scope: "/radar/" }).catch(() => {});
  try {
    await loadState();
    await loadList();
    openFromHash();
  } catch (e) {
    $("#status").textContent = e.message;
  }
  // пока идёт первый сбор — подтягиваем результаты
  setInterval(async () => {
    if (document.hidden || $("#sheet").classList.contains("open")) return;
    const before = state?.lastRun;
    await loadState().catch(() => {});
    if (state?.lastRun !== before && (tab === "feed" || tab === "starred")) loadList().catch(() => {});
  }, 30000);
})();
