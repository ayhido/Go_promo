import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import multer from "multer";
import { loadDb } from "./db.js";
import * as dispatcher from "./dispatcher.js";

const app = express();
app.use(express.json());

// ===== память =====
const leadsMemory = new Map();
const leadsStore = new Map();
let leadCounter = 1;

loadDb();

const upload = multer({ storage: multer.memoryStorage() });

// ===== статика =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ===== Telegram =====
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// ========= ПАРСЕР =========
function parseCandidate(text) {
  if (!text) return {};

  const cleaned = text.replace(/\n/g, " ").replace(/,/g, " ").trim();
  const words = cleaned.split(/\s+/);

  const nameMatch = cleaned.match(/[А-ЯЁ][а-яё]+/);
  const ageMatch = cleaned.match(/\b(1[6-9]|[2-5]\d|60)\b/);
  const phoneMatch = cleaned.match(/(\+?\d[\d\s\-()]{7,}\d)/);

  let city = "";
  for (let i = words.length - 1; i >= 0; i--) {
    if (!/\d+/.test(words[i])) {
      city = words[i];
      break;
    }
  }

  return {
    name: nameMatch ? nameMatch[0] : "Неизвестно",
    age: ageMatch ? parseInt(ageMatch[0]) : null,
    city,
    phone: phoneMatch ? phoneMatch[0].replace(/\D/g, "") : ""
  };
}

// ========= Telegram =========
async function sendTelegramNotification(lead, text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;

  const tgLink = lead.phone
    ? `https://t.me/+${lead.phone}`
    : "—";

  try {
    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        chat_id: TG_CHAT_ID,
        text:
          `🔥 Новый отклик\n\n` +
          `👤 ${lead.name}\n` +
          `🎂 ${lead.age || "—"}\n` +
          `🏙 ${lead.city}\n` +
          `📱 ${lead.phone || "—"}\n` +
          `🔗 ${tgLink}\n\n` +
          `💬 ${text}`
      }
    );
  } catch (e) {
    console.error("TG error:", e.message);
  }
}

// ========= webhook =========
app.post("/telegram-webhook", async (req, res) => {
  try {
    const q = req.body.callback_query;
    if (!q) return res.json({ ok: true });

    const [action, idStr] = q.data.split(":");

    // кнопки мастера под заказом
    if (action === "o_take" || action === "o_done") {
      const order = dispatcher.getOrder(idStr);
      if (order) {
        dispatcher.setStatus(order, action === "o_take" ? "in_work" : "done", action === "o_take" ? "Мастер взял заказ (Telegram)" : "Мастер закрыл заказ (Telegram)");
        broadcast();
      }
      return res.json({ ok: true });
    }

    const lead = leadsStore.get(Number(idStr));

    if (lead) {
      if (action === "ok") lead.status = "Записан";
      if (action === "no") lead.status = "Отказ";
    }

    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

// ========= добавление =========
app.post("/api/manual-lead", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text" });

    if (leadsMemory.has(text)) {
      return res.json({ ok: true, duplicate: true });
    }

    const parsed = parseCandidate(text);
    const id = leadCounter++;

    const lead = {
      id,
      name: parsed.name,
      age: parsed.age,
      city: parsed.city,
      phone: parsed.phone,
      status: parsed.age ? "Заполнен" : "Новый",
      createdAt: Date.now()
    };

    leadsMemory.set(text, lead);
    leadsStore.set(id, lead);

    await sendTelegramNotification(lead, text);

    res.json({ ok: true, lead });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// ========= импорт =========
app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Файл не выбран" });
    }

    const content = req.file.buffer.toString("utf-8");
    const lines = content.split("\n").map(x => x.trim()).filter(Boolean);

    let added = 0;

    for (const text of lines) {
      if (leadsMemory.has(text)) continue;

      const parsed = parseCandidate(text);
      const id = leadCounter++;

      const lead = {
        id,
        name: parsed.name,
        age: parsed.age,
        city: parsed.city,
        phone: parsed.phone,
        status: parsed.age ? "Заполнен" : "Новый",
        createdAt: Date.now()
      };

      leadsMemory.set(text, lead);
      leadsStore.set(id, lead);
      added++;
    }

    res.json({ ok: true, added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Import error" });
  }
});

// ========= список =========
app.get("/api/leads", (req, res) => {
  res.json([...leadsStore.values()]);
});

// ========= Excel =========
app.get("/api/export", (req, res) => {
  const ws = XLSX.utils.json_to_sheet([...leadsStore.values()]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Disposition", "attachment; filename=leads.xlsx");
  res.send(buf);
});

// ===================================================================
//  ИИ-диспетчер: заказы и мастера
// ===================================================================

// ===== живые обновления для панели (SSE) =====
const sseClients = new Set();

app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

function broadcast() {
  for (const res of sseClients) res.write(`data: ${Date.now()}\n\n`);
}

// раз в минуту: заказы стареют и могут попасть в «требует внимания»
setInterval(broadcast, 60000).unref();

// ===== Telegram для заказов =====
async function tgSend(chatId, text, buttons) {
  if (!TG_TOKEN || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      ...(buttons ? { reply_markup: { inline_keyboard: [buttons] } } : {})
    });
  } catch (e) {
    console.error("TG error:", e.message);
  }
}

async function notifyOrder(order) {
  const text = dispatcher.describeOrder(order);
  await tgSend(TG_CHAT_ID, `🛠 ${text}`);

  const master = order.masterId ? dispatcher.getMaster(order.masterId) : null;
  if (master?.tgChatId) {
    await tgSend(master.tgChatId, `🛠 Вам новый заказ\n\n${text}`, [
      { text: "✅ Беру", callback_data: `o_take:${order.id}` },
      { text: "🏁 Выполнен", callback_data: `o_done:${order.id}` }
    ]);
  }
}

const findOrder = (req, res) => {
  const order = dispatcher.getOrder(req.params.id);
  if (!order) res.status(404).json({ error: "Заказ не найден" });
  return order;
};

// ===== чат с диспетчером: заявка клиента или команда оператора =====
app.post("/api/dispatcher/chat", async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    if (!text) return res.status(400).json({ error: "No text" });

    const result = await dispatcher.handleMessage(text);
    if (result.changed) broadcast();
    if (result.notify) await notifyOrder(result.order);

    res.json({ ok: true, reply: result.reply, order: result.order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/dispatcher/status", (req, res) => {
  res.json({ ai: dispatcher.aiEnabled(), telegram: Boolean(TG_TOKEN && TG_CHAT_ID), summary: dispatcher.summary() });
});

app.get("/api/orders", (req, res) => {
  const attention = new Map(dispatcher.attentionList().map(x => [x.order.id, x.reasons]));
  res.json(dispatcher.listOrders().map(o => ({ ...o, attention: attention.get(o.id) || [] })));
});

app.post("/api/orders", async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    if (!text) return res.status(400).json({ error: "No text" });
    const order = await dispatcher.createOrder(text, req.body.source || "api");
    broadcast();
    await notifyOrder(order);
    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/orders/:id", (req, res) => {
  const order = findOrder(req, res);
  if (!order) return;
  try {
    if (req.body.status) dispatcher.setStatus(order, req.body.status);
    dispatcher.updateOrder(order, req.body);
    broadcast();
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/orders/:id/assign", async (req, res) => {
  const order = findOrder(req, res);
  if (!order) return;
  const master = req.body.masterId ? dispatcher.getMaster(req.body.masterId) : dispatcher.pickMaster(order);
  if (!master) return res.status(400).json({ error: "Нет подходящего мастера" });
  dispatcher.assignMaster(order, master);
  broadcast();
  await notifyOrder(order);
  res.json({ ok: true, order });
});

app.get("/api/masters", (req, res) => {
  res.json(dispatcher.listMasters());
});

app.post("/api/masters", (req, res) => {
  try {
    const master = dispatcher.addMaster(req.body);
    // новый мастер может забрать заказы, которые ждали
    for (const o of dispatcher.listOrders()) if (o.status === "new") dispatcher.autoAssign(o);
    broadcast();
    res.json({ ok: true, master });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/masters/:id", (req, res) => {
  const master = dispatcher.getMaster(req.params.id);
  if (!master) return res.status(404).json({ error: "Мастер не найден" });
  dispatcher.updateMaster(master, req.body);
  broadcast();
  res.json({ ok: true, master });
});

app.get("/api/orders/export", (req, res) => {
  const rows = dispatcher.listOrders().map(o => ({
    "№": o.id,
    Статус: dispatcher.STATUSES[o.status],
    Категория: o.category,
    Клиент: o.name,
    Телефон: o.phone,
    Город: o.city,
    Адрес: o.address,
    Когда: o.when,
    Срочно: o.urgent ? "да" : "",
    "Цена, ₽": o.estimate_rub,
    Мастер: dispatcher.getMaster(o.masterId)?.name || "",
    Описание: o.description,
    Создан: new Date(o.createdAt).toLocaleString("ru-RU")
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Disposition", "attachment; filename=orders.xlsx");
  res.send(buf);
});

app.get("/dispatcher", (req, res) => {
  res.sendFile(path.join(__dirname, "public/dispatcher.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server started", PORT));
