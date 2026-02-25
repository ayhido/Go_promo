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
