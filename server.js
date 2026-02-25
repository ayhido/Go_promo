const leadsMemory = new Map();
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
// ===============================
// 🔥 Telegram настройки
// ===============================
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// ===============================
// 🧠 Умный локальный парсер
// ===============================
async function aiParseCandidate(text) {
  if (!text) return {};

  const cleaned = text
    .replace(/\n/g, " ")
    .replace(/,/g, " ")
    .trim();

  const words = cleaned.split(/\s+/);

  // имя — первое слово с буквы
  const nameMatch = cleaned.match(/[А-ЯЁ][а-яё]+/);

  // возраст 16–60
  const ageMatch = cleaned.match(/\b(1[6-9]|[2-5]\d|60)\b/);

  // город — последнее слово не число
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

  await axios.post(
    `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    {
      chat_id: TG_CHAT_ID,
      text: message,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Записан", callback_data: "ok" },
            { text: "❌ Отказ", callback_data: "no" }
          ]
        ]
      }
    }
  );
}

// ===============================
// ✅ Проверка сервера
// ===============================
app.get("/", (req, res) => {
  res.send("GoPromo CRM backend is running 🚀");
});

// ===============================
// 🔥 Ручное добавление лида
// ===============================
app.post("/api/manual-lead", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const parsed = await aiParseCandidate(text);

// 🔥 антидубль по тексту
if (leadsMemory.has(text)) {
  return res.json leadsMemory.set(text, lead);({
    ok: true,
    duplicate: true,
    lead: leadsMemory.get(text)
  });
}

    const lead = {
      name: parsed.name || "Неизвестно",
      age: parsed.age,
      city: parsed.city || "",
      status: parsed.age ? "Заполнен" : "Новый",
      source: "Avito",
      lastMessage: text,
    };

    // 📲 уведомление в Telegram
    await sendTelegramNotification(lead, text);

    res.json({ ok: true, lead });
  } catch (e) {
    console.error("Manual lead error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
