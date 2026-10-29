import Anthropic from "@anthropic-ai/sdk";
import { db, saveDb } from "./db.js";

// ===================================================================
//  ИИ-диспетчер «мастер на час»
//  Принимает заявку клиента свободным текстом, превращает её в заказ,
//  подбирает мастера и следит, какие заказы ждут реакции человека.
// ===================================================================

export const CATEGORIES = [
  { name: "Сантехника", base: 1500, words: ["кран", "смесител", "унитаз", "труб", "засор", "сантех", "теч", "раковин", "бойлер", "водонагрев", "душ", "ванн", "сифон"] },
  { name: "Электрика", base: 1500, words: ["розетк", "выключател", "проводк", "электр", "люстр", "светильник", "лампочк", "автомат", "щиток", "искрит"] },
  { name: "Сборка мебели", base: 2000, words: ["собрать", "сборк", "шкаф", "кроват", "комод", "мебел", "стол ", "кухонн гарнитур", "разобрать"] },
  { name: "Навеска и монтаж", base: 1200, words: ["повесить", "навес", "карниз", "полк", "телевизор", "кронштейн", "зеркал", "картин", "просверл", "сверл"] },
  { name: "Двери и замки", base: 2000, words: ["двер", "замок", "замк", "петл", "ручк"] },
  { name: "Установка техники", base: 2000, words: ["стиральн", "посудомо", "холодильн", "плит", "духов", "вытяжк", "кондиционер"] },
  { name: "Отделка", base: 2500, words: ["плитк", "обои", "покрас", "шпакл", "ламинат", "плинтус", "штукатур", "герметик"] },
  { name: "Мелкий ремонт", base: 1500, words: [] }
];
const CATEGORY_NAMES = CATEGORIES.map(c => c.name);
const UNIVERSAL = "Универсал";

export const STATUSES = {
  new: "Новый",
  assigned: "Назначен",
  in_work: "В работе",
  done: "Выполнен",
  refused: "Отказ",
  cancelled: "Отменён"
};
// причины для кнопок и подсказок
export const REFUSE_REASONS = ["Дорого", "Передумал", "Не дозвонился", "Не смог сделать", "Другое"];
// доля компании с каждого выполненного заказа, % (0 — не считать)
const COMMISSION = Number(process.env.COMMISSION_PERCENT || 0);
const ACTIVE = ["new", "assigned", "in_work"];

const CITIES = [
  ["москв", "Москва"], ["мск", "Москва"], ["санкт-петербург", "Санкт-Петербург"], ["петербург", "Санкт-Петербург"],
  ["питер", "Санкт-Петербург"], ["спб", "Санкт-Петербург"], ["новосибирск", "Новосибирск"],
  ["екатеринбург", "Екатеринбург"], ["екб", "Екатеринбург"], ["казан", "Казань"],
  ["нижн", "Нижний Новгород"], ["челябинск", "Челябинск"], ["самар", "Самара"], ["омск", "Омск"],
  ["ростов", "Ростов-на-Дону"], ["уф", "Уфа"], ["красноярск", "Красноярск"], ["воронеж", "Воронеж"],
  ["перм", "Пермь"], ["волгоград", "Волгоград"], ["краснодар", "Краснодар"], ["тюмен", "Тюмень"],
  ["саратов", "Саратов"], ["тольятти", "Тольятти"], ["ижевск", "Ижевск"], ["барнаул", "Барнаул"],
  ["сочи", "Сочи"], ["калининград", "Калининград"], ["ярославл", "Ярославль"], ["иркутск", "Иркутск"],
  ["владивосток", "Владивосток"], ["хабаровск", "Хабаровск"], ["томск", "Томск"], ["оренбург", "Оренбург"]
];

const ATTENTION_MIN = Number(process.env.ATTENTION_MIN || 15);
const URGENT_SURCHARGE = 1.5;

// ========= разбор заявки правилами (работает без ИИ) =========
export function normalizePhone(raw) {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d.length >= 10 ? d : "";
}

// город, если он явно упомянут в тексте, иначе пустая строка
export function findCity(text) {
  const lower = String(text || "").toLowerCase();
  for (const [stem, city] of CITIES) {
    if (new RegExp(`(^|[^а-яё])${stem}`).test(lower)) return city;
  }
  return "";
}

function detectCity(lower) {
  return findCity(lower) || process.env.DEFAULT_CITY || "";
}

// ответ клиента «в спб» → «Санкт-Петербург», неизвестный город — как написан
export function normalizeCity(text) {
  const t = String(text || "").trim();
  const known = findCity(t);
  if (known) return known;
  const word = t.replace(/^(г\.|город|в)\s+/i, "").trim();
  return word ? word[0].toUpperCase() + word.slice(1) : "";
}

function detectCategory(lower) {
  let best = { name: "Мелкий ремонт", hits: 0 };
  for (const c of CATEGORIES) {
    const hits = c.words.filter(w => lower.includes(w)).length;
    if (hits > best.hits) best = { name: c.name, hits };
  }
  return best.name;
}

function detectWhen(lower) {
  const day = (lower.match(/послезавтра|завтра|сегодня|сейчас|в понедельник|во вторник|в среду|в четверг|в пятницу|в субботу|в воскресенье/) || [""])[0];
  const time = ((lower.match(/(?:^|\s)(?:после|к|в|с|до)\s*\d{1,2}(?::\d{2})?(?![\d-])/) || [""])[0]).trim();
  const part = (lower.match(/утром|днём|днем|вечером/) || [""])[0];
  return [day, time, part].filter(Boolean).join(" ").trim();
}

// превращает «завтра после 18» в конкретное время, чтобы видеть опоздания
function whenToDate(when, now = new Date()) {
  if (!when) return null;
  const d = new Date(now);
  if (when.includes("послезавтра")) d.setDate(d.getDate() + 2);
  else if (when.includes("завтра")) d.setDate(d.getDate() + 1);
  else if (!when.includes("сегодня") && !when.includes("сейчас")) return null;
  const t = when.match(/(\d{1,2})(?::(\d{2}))?/);
  if (t) d.setHours(Number(t[1]), Number(t[2] || 0), 0, 0);
  else if (when.includes("утром")) d.setHours(9, 0, 0, 0);
  else if (when.includes("вечером")) d.setHours(18, 0, 0, 0);
  else if (when.includes("днём") || when.includes("днем")) d.setHours(13, 0, 0, 0);
  else if (!when.includes("сейчас")) return null;
  return d.toISOString();
}

export function parseRequestRules(text) {
  const lower = text.toLowerCase();
  const phone = normalizePhone((text.match(/(\+?\d[\d\s\-()]{8,}\d)/) || [""])[0]);
  // «меня зовут Анна» или имя прямо перед номером: «Пётр 8917…»
  const nameMatch = text.match(/(?:зовут|имя[:\s]|я\s+—?)\s*([А-ЯЁ][а-яё]+)/) ||
    text.match(/([А-ЯЁ][а-яё]{2,})[,:\s]+\+?\d[\d\s\-()]{8,}\d/);
  const NOT_NAMES = /^(срочн|телефон|тел|номер|звон|пишите|контакт|сегодня|завтра|вечер|утр)/;
  const name = nameMatch && !NOT_NAMES.test(nameMatch[1].toLowerCase()) &&
    !CITIES.some(([stem]) => nameMatch[1].toLowerCase().startsWith(stem)) ? nameMatch[1] : "";
  const address = (text.match(/(?:ул\.?|улица|пр-т|проспект|пер\.?|переулок|ш\.|шоссе|бульвар|б-р|наб\.?|набережная|мкр\.?)\s+[^,.;\n]+(?:,?\s*(?:д\.?|дом)\s*\d+[а-яё]?)?(?:,?\s*(?:к\.?|корп\.?|корпус)\s*\d+)?(?:,?\s*(?:кв\.?|квартира)\s*\d+)?/i) || [""])[0].trim();
  const category = detectCategory(lower);
  const urgent = /срочн|сейчас|прямо|авари|затоп|заливает|хлещет|искрит|не могу выйти|захлопнул/.test(lower);
  const base = CATEGORIES.find(c => c.name === category).base;

  return {
    name,
    phone,
    city: detectCity(lower),
    address,
    category,
    description: text.trim().slice(0, 500),
    when: detectWhen(lower),
    urgent,
    estimate_rub: Math.round(base * (urgent ? URGENT_SURCHARGE : 1))
  };
}

// ========= разбор заявки через Claude (если задан ключ) =========
const ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "phone", "city", "address", "category", "description", "when", "urgent", "estimate_rub"],
  properties: {
    name: { type: "string", description: "Имя клиента или пустая строка" },
    phone: { type: "string", description: "Телефон только цифрами в формате 7XXXXXXXXXX или пустая строка" },
    city: { type: "string", description: "Город в именительном падеже или пустая строка" },
    address: { type: "string", description: "Улица, дом, квартира или пустая строка" },
    category: { type: "string", enum: CATEGORY_NAMES },
    description: { type: "string", description: "Коротко, что нужно сделать" },
    when: { type: "string", description: "Когда удобно клиенту, как он сказал, или пустая строка" },
    urgent: { type: "boolean" },
    estimate_rub: { type: "integer", description: "Ориентировочная цена работы в рублях" }
  }
};

const AI_SYSTEM =
  "Ты диспетчер сервиса «мастер на час» в России. Из сообщения клиента извлеки данные заказа. " +
  "Ничего не выдумывай: если данных нет, оставь пустую строку. " +
  "Срочно — если течёт, заливает, искрит, захлопнулась дверь или клиент просит прямо сейчас. " +
  "Цена — ориентир по рынку для обычного мастера на час, без материалов; за срочность +50%. " +
  "Базовые цены: " + CATEGORIES.map(c => `${c.name} от ${c.base} ₽`).join(", ") + ".";

const hasAiKey = () =>
  !process.env.AI_DISABLED && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client = null;
async function parseRequestAi(text) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: process.env.AI_MODEL || "claude-opus-5-5",
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ORDER_SCHEMA } },
    system: AI_SYSTEM,
    messages: [{ role: "user", content: text }]
  });
  if (response.stop_reason === "refusal") throw new Error("AI refusal");
  const block = response.content.find(b => b.type === "text");
  if (!block) throw new Error("AI empty response");
  const parsed = JSON.parse(block.text);
  parsed.phone = normalizePhone(parsed.phone);
  if (!CATEGORY_NAMES.includes(parsed.category)) parsed.category = "Мелкий ремонт";
  return parsed;
}

export async function parseRequest(text) {
  if (hasAiKey()) {
    try {
      return { ...(await parseRequestAi(text)), parsedBy: "ai" };
    } catch (e) {
      console.error("AI parse error, fallback to rules:", e.message);
    }
  }
  return { ...parseRequestRules(text), parsedBy: "rules" };
}

export const aiEnabled = hasAiKey;

// ========= заказы =========
const now = () => Date.now();

export function listOrders() {
  return db().orders;
}

export function getOrder(id) {
  return db().orders.find(o => o.id === Number(id));
}

export async function createOrder(text, source = "chat") {
  return createOrderFromParsed(await parseRequest(text), source);
}

// extra — поля, которые нужны до автоназначения (например, чат клиента для уведомлений)
export function createOrderFromParsed(parsed, source, extra = {}) {
  const order = {
    id: db().orderCounter++,
    ...parsed,
    ...extra,
    whenAt: whenToDate(parsed.when),
    source,
    status: "new",
    masterId: null,
    createdAt: now(),
    updatedAt: now(),
    history: [{ at: now(), text: "Заказ создан" }]
  };
  db().orders.push(order);
  autoAssign(order);
  saveDb();
  return order;
}

// подписчики на смену статуса (например, Telegram-бот клиента)
const listeners = [];
export function onStatusChange(fn) {
  listeners.push(fn);
}

export function setStatus(order, status, note) {
  if (!STATUSES[status]) throw new Error("Неизвестный статус");
  order.status = status;
  order.updatedAt = now();
  order.history.push({ at: now(), text: note || `Статус: ${STATUSES[status]}` });
  saveDb();
  // вызываем сразу: подписчик видит заказ ровно в момент смены статуса
  for (const fn of listeners) {
    try {
      Promise.resolve(fn(order, status, note)).catch(e => console.error("Status listener error:", e.message));
    } catch (e) {
      console.error("Status listener error:", e.message);
    }
  }
  return order;
}

// оценка клиента: одна на заказ, рейтинг мастера — среднее всех оценок
export function rateOrder(order, stars) {
  if (order.status !== "done" || order.rating) return false;
  order.rating = stars;
  order.history.push({ at: now(), text: `Оценка клиента: ${stars}` });
  const master = order.masterId ? getMaster(order.masterId) : null;
  if (master) {
    master.ratings = [...(master.ratings || []), stars];
    master.rating = Math.round((master.ratings.reduce((a, b) => a + b, 0) / master.ratings.length) * 10) / 10;
  }
  saveDb();
  return true;
}

export function updateOrder(order, patch) {
  const allowed = ["name", "phone", "city", "address", "category", "description", "when", "urgent", "estimate_rub"];
  for (const k of allowed) if (k in patch) order[k] = patch[k];
  if ("phone" in patch) order.phone = normalizePhone(patch.phone);
  if ("when" in patch) order.whenAt = whenToDate(order.when, new Date(order.createdAt));
  order.updatedAt = now();
  saveDb();
  return order;
}

// ========= мастера =========
export function listMasters() {
  return db().masters.map(m => ({ ...m, load: masterLoad(m.id), today: masterStats(m.id) }));
}

export function getMaster(id) {
  return db().masters.find(m => m.id === Number(id));
}

export function addMaster({ name, phone, city, skills, rating, tgChatId }) {
  if (!name) throw new Error("Нужно имя мастера");
  const master = {
    id: db().masterCounter++,
    name: String(name).trim(),
    phone: normalizePhone(phone),
    city: String(city || "").trim(),
    skills: (Array.isArray(skills) ? skills : String(skills || UNIVERSAL).split(","))
      .map(s => s.trim()).filter(Boolean),
    rating: Number(rating) || 5,
    tgChatId: tgChatId ? String(tgChatId).trim() : "",
    active: true,
    createdAt: now()
  };
  db().masters.push(master);
  saveDb();
  return master;
}

export function updateMaster(master, patch) {
  for (const k of ["name", "city", "rating", "tgChatId", "active"]) if (k in patch) master[k] = patch[k];
  if ("phone" in patch) master.phone = normalizePhone(patch.phone);
  if ("skills" in patch) master.skills = [].concat(patch.skills).flatMap(s => String(s).split(",")).map(s => s.trim()).filter(Boolean);
  saveDb();
  return master;
}

function masterLoad(masterId) {
  return db().orders.filter(o => o.masterId === masterId && ["assigned", "in_work"].includes(o.status)).length;
}

const sameCity = (a, b) => !a || !b || a.toLowerCase() === b.toLowerCase();

// лучший свободный мастер: тот же город, есть навык, меньше всего заказов, выше рейтинг
export function pickMaster(order) {
  const declined = order.declinedBy || [];
  const candidates = db().masters.filter(m =>
    m.active &&
    !declined.includes(m.id) &&
    sameCity(m.city, order.city) &&
    (m.skills.includes(order.category) || m.skills.includes(UNIVERSAL))
  );
  candidates.sort((a, b) =>
    masterLoad(a.id) - masterLoad(b.id) ||
    b.rating - a.rating ||
    Number(b.skills.includes(order.category)) - Number(a.skills.includes(order.category))
  );
  return candidates[0] || null;
}

export function assignMaster(order, master) {
  order.masterId = master.id;
  setStatus(order, "assigned", `Назначен мастер ${master.name}`);
  return order;
}

export function autoAssign(order) {
  const master = pickMaster(order);
  if (master) assignMaster(order, master);
  return master;
}

// ===== закрытие заказа: сколько взял мастер, отказ или отмена =====
// result: done | refused | cancelled; amount — сколько денег взято с клиента
export function closeOrder(order, { result, amount, reason = "", by = "" }) {
  if (!["done", "refused", "cancelled"].includes(result)) throw new Error("Неизвестный результат");
  const digits = amount === undefined || amount === null ? "" : String(amount).replace(/[^\d.,]/g, "").replace(",", ".");
  const sum = digits === "" ? null : Math.round(Number(digits));
  if (sum !== null && !(sum >= 0 && sum < 10_000_000)) throw new Error("Сумма указана неверно");
  if (result === "done" && sum === null) throw new Error("Укажите, сколько взяли с клиента");
  order.amount = sum ?? 0;
  order.closeReason = String(reason).slice(0, 200);
  order.closedAt = now();
  if (COMMISSION) order.commission = Math.round(order.amount * COMMISSION / 100);
  const note =
    result === "done" ? `Выполнен, взято ${rub(order.amount)}` :
    result === "refused" ? `Отказ${order.closeReason ? ": " + order.closeReason : ""}${order.amount ? `, взято за выезд ${rub(order.amount)}` : ""}` :
    `Отменён${order.closeReason ? ": " + order.closeReason : ""}`;
  return setStatus(order, result, by ? `${note} (${by})` : note);
}

// мастер не может взять заказ — отдаём следующему
export function declineByMaster(order, master) {
  order.declinedBy = [...new Set([...(order.declinedBy || []), master.id])];
  order.masterId = null;
  setStatus(order, "new", `Мастер ${master.name} отказался от заказа`);
  return autoAssign(order);
}

// деньги и заказы мастера за период (по умолчанию — сегодня)
export function masterStats(masterId, since = startOfDay()) {
  const mine = db().orders.filter(o => o.masterId === masterId && (o.closedAt || o.updatedAt) >= since);
  const done = mine.filter(o => o.status === "done");
  return {
    done: done.length,
    refused: mine.filter(o => o.status === "refused").length,
    amount: mine.filter(o => ["done", "refused"].includes(o.status)).reduce((s, o) => s + (o.amount || 0), 0)
  };
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ========= что требует внимания человека =========
export function attentionReasons(order, at = now()) {
  if (!ACTIVE.includes(order.status)) return [];
  const reasons = [];
  const waitMin = Math.round((at - order.createdAt) / 60000);
  if (order.status === "new" && waitMin >= ATTENTION_MIN) reasons.push(`ждёт мастера ${waitMin} мин`);
  if (order.status === "new" && !pickMaster(order)) reasons.push(`нет свободного мастера${order.city ? " в городе " + order.city : ""}`);
  if (!order.phone) reasons.push("нет телефона клиента");
  if (!order.address) reasons.push("нет адреса");
  if (order.urgent) reasons.push("срочный");
  if (order.status === "assigned" && order.whenAt && new Date(order.whenAt).getTime() < at) {
    reasons.push("время визита прошло, а мастер не начал работу");
  }
  return reasons;
}

export function attentionList() {
  return db().orders
    .map(o => ({ order: o, reasons: attentionReasons(o) }))
    .filter(x => x.reasons.length)
    .sort((a, b) => Number(b.order.urgent) - Number(a.order.urgent) || a.order.createdAt - b.order.createdAt);
}

export function summary() {
  const orders = db().orders;
  const count = s => orders.filter(o => o.status === s).length;
  const today = startOfDay();
  const closedToday = orders.filter(o => (o.closedAt || o.updatedAt) >= today);
  const paid = closedToday.filter(o => ["done", "refused"].includes(o.status));
  return {
    new: count("new"),
    assigned: count("assigned"),
    in_work: count("in_work"),
    done: count("done"),
    doneToday: closedToday.filter(o => o.status === "done").length,
    refusedToday: closedToday.filter(o => o.status === "refused").length,
    cancelledToday: closedToday.filter(o => o.status === "cancelled").length,
    // реальные деньги: сколько мастера взяли с клиентов (у старых заказов без суммы — ориентир)
    revenueToday: paid.reduce((s, o) => s + (o.amount ?? (o.status === "done" ? Number(o.estimate_rub) || 0 : 0)), 0),
    commissionToday: paid.reduce((s, o) => s + (o.commission || 0), 0),
    attention: attentionList().length,
    masters: db().masters.filter(m => m.active).length
  };
}

// ========= человекочитаемые ответы диспетчера =========
const rub = n => `${Number(n || 0).toLocaleString("ru-RU")} ₽`;

export function describeOrder(o) {
  const m = o.masterId ? getMaster(o.masterId) : null;
  return [
    `Заказ №${o.id}${o.urgent ? " (СРОЧНО)" : ""}: ${o.category}`,
    o.description && `Что сделать: ${o.description}`,
    `Клиент: ${o.name || "без имени"}, ${o.phone ? "+" + o.phone : "телефона нет"}`,
    `Адрес: ${[o.city, o.address].filter(Boolean).join(", ") || "не указан"}`,
    o.when && `Когда: ${o.when}`,
    `Ориентир по цене: ${rub(o.estimate_rub)}`,
    o.amount !== undefined && ["done", "refused"].includes(o.status) && `Взято с клиента: ${rub(o.amount)}`,
    o.closeReason && `Причина: ${o.closeReason}`,
    `Мастер: ${m ? `${m.name}${m.phone ? ", +" + m.phone : ""}` : "не назначен"}`
  ].filter(Boolean).join("\n");
}

function summaryText() {
  const s = summary();
  return `Новых заказов: ${s.new}, назначено: ${s.assigned}, в работе: ${s.in_work}. ` +
    `Сегодня выполнено ${s.doneToday}, отказов ${s.refusedToday}, отмен ${s.cancelledToday}. ` +
    `Касса за сегодня: ${rub(s.revenueToday)}${s.commissionToday ? `, доля компании ${rub(s.commissionToday)}` : ""}. ` +
    `Активных мастеров: ${s.masters}. ` +
    (s.attention ? `Требуют внимания: ${s.attention}.` : "Ничего не горит.");
}

function attentionText() {
  const list = attentionList();
  if (!list.length) return "Всё под контролем, ни один заказ не ждёт вашей реакции.";
  return "Требуют внимания:\n" + list.slice(0, 10)
    .map(({ order, reasons }) => `№${order.id} ${order.category}${order.city ? ", " + order.city : ""} — ${reasons.join(", ")}`)
    .join("\n");
}

function mastersText() {
  const ms = listMasters();
  if (!ms.length) return "Мастеров пока нет. Добавьте их на панели справа, и я начну назначать заказы автоматически.";
  return ms.map(m => `${m.active ? "🟢" : "⚪"} ${m.name} (${m.city || "любой город"}): ${m.skills.join(", ")}; заказов в работе: ${m.load}; рейтинг ${m.rating}; сегодня: ${m.today.done} выполн., ${m.today.refused} отказ., взял ${rub(m.today.amount)}`).join("\n");
}

// «назначь 3 на Ивана» — имя в винительном падеже, сравниваем по основе слова
function findMasterByName(name) {
  const word = name.toLowerCase().split(/\s+/)[0];
  const stem = word.length > 4 ? word.slice(0, -2) : word.length > 3 ? word.slice(0, -1) : word;
  return db().masters.find(m => m.name.toLowerCase().split(/\s+/).some(w => w.startsWith(stem)));
}

// главная точка входа: команда оператора или заявка клиента
export async function handleMessage(text) {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (/^(сводк|статус|отч[её]т|как дела|что у нас)/.test(lower)) return { reply: summaryText() };
  if (/внимани|кто ждёт|кто ждет|что горит|проблем/.test(lower)) return { reply: attentionText() };
  if (/^(мастера|список мастеров|кто из мастеров)/.test(lower)) return { reply: mastersText() };

  let m = lower.match(/^заказ\s*№?\s*(\d+)\s*$/);
  if (m) {
    const o = getOrder(m[1]);
    return { reply: o ? describeOrder(o) : `Заказа №${m[1]} нет.`, order: o };
  }

  // «5 в работе», «5 выполнен 3500», «5 отказ дорого 500», «отмени 5 клиент передумал»
  m = lower.match(/(?:заказ\s*)?№?\s*(\d+)\s+(выполнен|готов|сделан|в работу|в работе|отказ|отмен[её]н|отменить)\s*(.*)$/) ||
      lower.match(/(отмени|отменить)\s+(?:заказ\s*)?№?\s*(\d+)\s*(.*)$/);
  if (m) {
    const [id, word] = /^\d+$/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const rest = (m[3] || "").trim();
    const o = getOrder(id);
    if (!o) return { reply: `Заказа №${id} нет.` };
    if (/работ/.test(word)) {
      setStatus(o, "in_work");
      return { reply: `Заказ №${o.id}: в работе.`, order: o, changed: true };
    }
    const sum = (rest.match(/\d[\d\s]*/) || [""])[0].replace(/\s/g, "");
    const reason = rest.replace(/\d[\d\s]*(₽|руб\S*|р\.?)?/g, "").trim();
    const result = /выполн|готов|сделан/.test(word) ? "done" : /отказ/.test(word) ? "refused" : "cancelled";
    if (result === "done" && !sum) return { reply: `Сколько взяли с клиента? Напишите, например: «${o.id} выполнен 3500».` };
    closeOrder(o, { result, amount: sum || 0, reason, by: "диспетчер" });
    return { reply: `Заказ №${o.id}: ${STATUSES[result].toLowerCase()}${sum ? `, взято ${rub(sum)}` : ""}${reason ? ` (${reason})` : ""}.`, order: o, changed: true };
  }

  m = t.match(/назнач\S*\s+(?:заказ\s*)?№?\s*(\d+)\s+(?:на\s+)?(.+)/i);
  if (m) {
    const o = getOrder(m[1]);
    const master = findMasterByName(m[2].trim());
    if (!o) return { reply: `Заказа №${m[1]} нет.` };
    if (!master) return { reply: `Не нашёл мастера «${m[2].trim()}».` };
    assignMaster(o, master);
    return { reply: `Готово: на заказ №${o.id} назначен ${master.name}.`, order: o, changed: true, notify: true };
  }

  if (t.length < 8) {
    return {
      reply: "Пришлите заявку клиента своими словами, например: «Течёт кран на кухне, Москва, ул. Ленина 5 кв 12, завтра после 18, Анна +7 999 123-45-67». " +
        "Ещё я понимаю: «сводка», «что требует внимания», «мастера», «заказ 3», «3 выполнен 3500», «3 отказ дорого», «отмени 3», «назначь 3 на Ивана»."
    };
  }

  const order = await createOrder(t, "chat");
  const master = order.masterId ? getMaster(order.masterId) : null;
  const missing = [!order.phone && "телефон", !order.address && "адрес", !order.when && "удобное время"].filter(Boolean);
  const reply =
    `Принял. ${describeOrder(order)}` +
    (master ? "" : "\nСвободного мастера под эту заявку нет, назначьте вручную.") +
    (missing.length ? `\nУточните у клиента: ${missing.join(", ")}.` : "");
  return { reply, order, changed: true, notify: true };
}
