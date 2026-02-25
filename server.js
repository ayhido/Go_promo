import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import multer from "multer";

const app = express();
app.use(express.json());

// ===== память =====
const leadsMemory = new Map();
const leadsStore = new Map();
let leadCounter = 1;

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server started", PORT));
