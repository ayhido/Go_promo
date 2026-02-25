import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
async function aiParseCandidate(text) {
  const prompt = `
Извлеки данные кандидата из сообщения.

Верни JSON:
{
 "name": "",
 "age": number | null,
 "city": ""
}

Сообщение:
${text}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return {};
  }
}
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// проверка сервера
app.get("/", (req, res) => {
  res.send("GoPromo CRM backend is running 🚀");
});

// webhook Авито
app.post("/api/avito/webhook", async (req, res) => {
  res.sendStatus(200);
  console.log("Avito webhook:", req.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
});
// 🔥 ручное добавление лида из Авито
app.post("/api/manual-lead", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    // 🧠 AI разбор
    const parsed = await aiParseCandidate(text);

    const lead = {
      name: parsed.name || "Неизвестно",
      age: parsed.age,
      city: parsed.city || "",
      status: parsed.age ? "Заполнен" : "Новый",
      source: "Avito",
      lastMessage: text,
    };

    // 📲 Telegram уведомление
    await sendTelegramNotification(lead, text);

    res.json({ ok: true, lead });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});
