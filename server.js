import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

// ===============================
// ⚙️ базовая настройка
// ===============================
const app = express();
app.use(express.json());

// антидубли
const leadsMemory = new Map();

// база лидов
const leadsStore = new Map();
let leadCounter = 1;

// пути статики
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// 🔥 Telegram настройки
// ===============================
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// ===============================
// 🧠 локальный парсер
// ===============================
async function aiParseCandidate(text) {
  if (!text) return {};

  const cleaned = text
    .replace(/\n/g, " ")
    .replace(/,/g, " ")
    .trim();

  const words = cleaned.split(/\s+/);

  const nameMatch = cleaned.match(/[А-ЯЁ][а-яё]+/);
  const ageMatch = cleaned.match(/\b(1[6-9]|[2-5]\d|60)\b/);

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
    city: city || ""
  };
}

// ===============================
// 📲 Telegram уведомление
// ===============================
async function sendTelegramNotification(lead, text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;

  const message =
    `🔥 Новый отклик с Авито\n\n` +
    `👤 ${lead.name || "—"} | 🎂 ${lead.age || "—"} | 🏙 ${lead.city || "—"}\n\n` +
    `💬 ${text}`;

  try {
    await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
      {
        chat_id: TG_CHAT_ID,
        text: message,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Записан", callback_data: `ok:${lead.id}` },
              { text: "❌ Отказ", callback_data: `no:${lead.id}` }
            ]
          ]
        }
      }
    );
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

// ===============================
// 🤖 Telegram webhook
// ===============================
app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      const data = update.callback_query.data;
      const chatId = update.callback_query.message.chat.id;
      const messageId = update.callback_query.message.message_id;

      const [action, leadIdStr] = data.split(":");
      const leadId = Number(leadIdStr);

      let text = "Статус обновлён";

      const lead = leadsStore.get(leadId);

      if (lead) {
        if (action === "ok") {
          lead.status = "Записан";
          text = `✅ ${lead.name} записан`;
        }

        if (action === "no") {
          lead.status = "Отказ";
          text = `❌ ${lead.name} отказ`;
        }
      }

      await axios.post(
        `https://api.telegram.org/bot${TG_TOKEN}/editMessageText`,
        {
          chat_id: chatId,
          message_id: messageId,
          text
        }
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Telegram webhook error:", e.message);
    res.json({ ok: true });
  }
});

// ===============================
// ✅ проверка сервера
// ===============================
app.get("/", (req, res) => {
  res.send("GoPromo CRM backend is running 🚀");
});

// ===============================
// 🔥 ручное добавление лида
// ===============================
app.post("/api/manual-lead", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    // антидубль
    if (leadsMemory.has(text)) {
      return res.json({
        ok: true,
        duplicate: true,
        lead: leadsMemory.get(text)
      });
    }

    const parsed = await aiParseCandidate(text);

    const id = leadCounter++;

    const lead = {
      id,
      name: parsed.name || "Неизвестно",
      age: parsed.age,
      city: parsed.city || "",
      status: parsed.age ? "Заполнен" : "Новый",
      source: "Avito",
      lastMessage: text,
      createdAt: Date.now()
    };

    leadsMemory.set(text, lead);
    leadsStore.set(id, lead);

    await sendTelegramNotification(lead, text);

    res.json({ ok: true, lead });
  } catch (e) {
    console.error("Manual lead error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// 📊 статистика
// ===============================
app.get("/api/stats", (req, res) => {
  const stats = {
    total: leadsStore.size,
    zapisano: [...leadsStore.values()].filter(l => l.status === "Записан").length,
    otkaz: [...leadsStore.values()].filter(l => l.status === "Отказ").length,
    new: [...leadsStore.values()].filter(l => l.status === "Новый").length
  };

  res.json(stats);
});

// ===============================
// 🚀 запуск
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
