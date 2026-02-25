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
});import OpenAI from "openai";

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
