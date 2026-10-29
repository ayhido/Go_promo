import axios from "axios";
import { db, saveDb } from "./db.js";
import * as dispatcher from "./dispatcher.js";

// ===================================================================
//  Telegram-бот для клиентов: приём заявок, статусы, оценка мастера.
//  Работает в том же боте, что и уведомления (TG_TOKEN):
//  личные чаты клиентов — здесь, кнопки мастеров и CRM — в server.js.
// ===================================================================

const BTN = {
  order: "🛠 Оставить заявку",
  my: "📋 Мои заказы",
  prices: "💰 Цены",
  operator: "📞 Связаться с оператором",
  phone: "📱 Отправить мой номер",
  cancel: "Отмена"
};

const MAIN_KEYBOARD = {
  keyboard: [[{ text: BTN.order }], [{ text: BTN.my }, { text: BTN.prices }], [{ text: BTN.operator }]],
  resize_keyboard: true
};

const WHEN_KEYBOARD = {
  keyboard: [[{ text: "Как можно скорее" }], [{ text: "Сегодня" }, { text: "Завтра" }], [{ text: BTN.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: true
};

const PHONE_KEYBOARD = {
  keyboard: [[{ text: BTN.phone, request_contact: true }], [{ text: BTN.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: true
};

const CANCEL_KEYBOARD = { keyboard: [[{ text: BTN.cancel }]], resize_keyboard: true };

const QUESTIONS = {
  describe: ["Опишите, что нужно сделать. Например: «течёт кран на кухне» или «собрать шкаф из IKEA». Можно приложить фото.", CANCEL_KEYBOARD],
  city: ["В каком вы городе?", CANCEL_KEYBOARD],
  address: ["Напишите адрес: улица, дом, квартира.", CANCEL_KEYBOARD],
  when: ["Когда удобно, чтобы пришёл мастер? Выберите или напишите своими словами, например «завтра после 18».", WHEN_KEYBOARD],
  phone: ["Оставьте номер телефона, чтобы мастер мог позвонить. Нажмите кнопку ниже или напишите номер.", PHONE_KEYBOARD]
};

const MAX_TEXT = 1000;
const rub = n => `${Number(n || 0).toLocaleString("ru-RU")} ₽`;

export function createClientBot({ token, apiBase = "https://api.telegram.org", operatorChatId, onOrderCreated }) {
  const enabled = Boolean(token);

  // lastError.network = true — Telegram не ответил (блокировка, нет интернета), иначе Telegram отказал
  const lastError = { network: false, message: "" };

  async function api(method, payload) {
    if (!enabled) return null;
    try {
      const { data } = await axios.post(`${apiBase}/bot${token}/${method}`, payload, { timeout: Number(process.env.TG_TIMEOUT || 40000) });
      return data.result;
    } catch (e) {
      lastError.network = !e.response;
      lastError.message = e.response?.data?.description || e.message;
      console.error(`TG ${method} error:`, lastError.message);
      return null;
    }
  }

  const send = (chatId, text, replyMarkup) =>
    api("sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });

  // ===== состояние диалога хранится в db.json, чтобы пережить перезапуск =====
  function session(chatId) {
    const all = (db().botSessions ??= {});
    return (all[chatId] ??= { step: "idle", draft: null });
  }

  function reset(chatId) {
    db().botSessions[chatId] = { step: "idle", draft: null };
    saveDb();
  }

  const isMasterChat = chatId => db().masters.some(m => m.tgChatId && String(m.tgChatId) === String(chatId));

  // ===== шаги анкеты =====
  function nextMissing(draft) {
    if (!draft.city) return "city";
    if (!draft.address) return "address";
    if (!draft.when) return "when";
    if (!draft.phone) return "phone";
    return "confirm";
  }

  async function ask(chatId, s) {
    s.step = nextMissing(s.draft);
    saveDb();
    if (s.step === "confirm") return showConfirm(chatId, s.draft);
    const [text, keyboard] = QUESTIONS[s.step];
    return send(chatId, text, keyboard);
  }

  async function showConfirm(chatId, d) {
    await send(chatId, "Проверьте заявку:", { remove_keyboard: true });
    return send(chatId,
      [
        `🛠 ${d.category}${d.urgent ? " (срочно)" : ""}`,
        `📝 ${d.description}`,
        `📍 ${[d.city, d.address].filter(Boolean).join(", ")}`,
        `🕒 ${d.when}`,
        `👤 ${d.name || "—"}, +${d.phone}`,
        d.photos?.length ? `📷 Фото: ${d.photos.length}` : "",
        "",
        `Ориентировочная стоимость работы: от ${rub(d.estimate_rub)}. Точную цену мастер назовёт на месте, материалы оплачиваются отдельно.`
      ].filter(Boolean).join("\n"),
      { inline_keyboard: [[{ text: "✅ Отправить заявку", callback_data: "c_ok" }], [{ text: "✏️ Заполнить заново", callback_data: "c_edit" }, { text: "❌ Отмена", callback_data: "c_cancel" }]] }
    );
  }

  function newDraft(s, from) {
    s.step = "describe";
    s.draft = { name: from?.first_name || "", tgUsername: from?.username || "", photos: [] };
    saveDb();
  }

  async function startDraft(chatId, from, s) {
    newDraft(s, from);
    const [text, keyboard] = QUESTIONS.describe;
    return send(chatId, text, keyboard);
  }

  // описание задачи разбирается так же, как в диспетчере (Claude или правила)
  async function acceptDescription(chatId, text, s) {
    await api("sendChatAction", { chat_id: chatId, action: "typing" });
    const parsed = await dispatcher.parseRequest(text);
    const keep = s.draft || {};
    s.draft = {
      ...parsed,
      name: parsed.name || keep.name || "",
      tgUsername: keep.tgUsername || "",
      photos: keep.photos || [],
      // город по умолчанию (DEFAULT_CITY) клиенту не подставляем — лучше спросить
      city: parsed.parsedBy === "ai" ? parsed.city : dispatcher.findCity(text)
    };
    return ask(chatId, s);
  }

  async function submit(chatId, s) {
    const d = s.draft;
    const order = dispatcher.createOrderFromParsed(
      {
        name: d.name, phone: d.phone, city: d.city, address: d.address, category: d.category,
        description: d.description, when: d.when, urgent: d.urgent, estimate_rub: d.estimate_rub,
        parsedBy: d.parsedBy
      },
      "telegram",
      { tgUsername: d.tgUsername, photos: d.photos || [] }
    );
    // чат клиента привязываем после автоназначения: о мастере скажем в этом же ответе,
    // а дальше клиент будет получать уведомления о смене статуса
    order.clientChatId = String(chatId);
    reset(chatId);

    const m = order.masterId ? dispatcher.getMaster(order.masterId) : null;
    await send(chatId,
      `Заявка №${order.id} принята! ` +
      (m
        ? `Мастер ${m.name}${m.phone ? ", телефон +" + m.phone : ""}. Он свяжется с вами, чтобы уточнить время.`
        : "Подбираем мастера, напишем, как только он будет назначен."),
      MAIN_KEYBOARD
    );
    await onOrderCreated?.(order);
    return order;
  }

  // ===== меню =====
  async function showMyOrders(chatId) {
    const mine = db().orders.filter(o => o.clientChatId === String(chatId)).slice(-5).reverse();
    if (!mine.length) return send(chatId, "У вас пока нет заявок.", MAIN_KEYBOARD);
    for (const o of mine) {
      const m = o.masterId ? dispatcher.getMaster(o.masterId) : null;
      const canCancel = ["new", "assigned"].includes(o.status);
      await send(chatId,
        `№${o.id} · ${o.category} · ${dispatcher.STATUSES[o.status]}\n${o.description.slice(0, 120)}` +
        (m && o.status !== "cancelled" ? `\nМастер: ${m.name}${m.phone ? ", +" + m.phone : ""}` : ""),
        canCancel ? { inline_keyboard: [[{ text: `Отменить заявку №${o.id}`, callback_data: `c_cancel_order:${o.id}` }]] } : undefined
      );
    }
  }

  function pricesText() {
    return "Ориентировочные цены за работу (без материалов):\n" +
      dispatcher.CATEGORIES.map(c => `• ${c.name}: от ${rub(c.base)}`).join("\n") +
      "\n\nСрочный выезд +50%. Точную цену мастер назовёт на месте.";
  }

  async function callOperator(chatId, from) {
    const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ");
    await send(operatorChatId,
      `📞 Клиент просит связаться\n👤 ${name || "без имени"}${from?.username ? " @" + from.username : ""}\nTelegram id: ${chatId}`);
    return send(chatId, "Передал оператору, он скоро напишет вам здесь или перезвонит.", MAIN_KEYBOARD);
  }

  // ===== обработка входящих =====
  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    if (msg.chat.type !== "private") return;
    if (isMasterChat(chatId)) {
      return send(chatId, "Вы зарегистрированы как мастер: новые заказы будут приходить сюда с кнопками «Беру» и «Выполнен».");
    }

    const s = session(chatId);
    const text = String(msg.text || msg.caption || "").trim().slice(0, MAX_TEXT);

    if (text === "/start" || text.startsWith("/start ") || text === "/menu") {
      reset(chatId);
      return send(chatId,
        "Здравствуйте! Это сервис «мастер на час»: сантехника, электрика, сборка мебели, навеска и мелкий ремонт.\n\n" +
        "Просто напишите, что случилось, и мы пришлём мастера.", MAIN_KEYBOARD);
    }
    if (text === BTN.cancel || text === "/cancel") {
      reset(chatId);
      return send(chatId, "Хорошо, отменил. Если понадобится мастер — пишите.", MAIN_KEYBOARD);
    }
    if (text === BTN.order) return startDraft(chatId, msg.from, s);
    if (text === BTN.my) return showMyOrders(chatId);
    if (text === BTN.prices) return send(chatId, pricesText(), MAIN_KEYBOARD);
    if (text === BTN.operator) return callOperator(chatId, msg.from);

    // фото можно прислать на любом шаге анкеты
    if (msg.photo?.length) {
      if (s.step === "idle") newDraft(s, msg.from);
      s.draft.photos.push(msg.photo[msg.photo.length - 1].file_id);
      saveDb();
      if (!text) {
        return s.step === "describe"
          ? send(chatId, "Фото добавил. Теперь опишите словами, что нужно сделать.")
          : send(chatId, "Фото добавил.");
      }
    }

    if (msg.contact && s.step === "phone") {
      s.draft.phone = dispatcher.normalizePhone(msg.contact.phone_number);
      return ask(chatId, s);
    }

    if (!text) return send(chatId, "Напишите, пожалуйста, текстом.");

    switch (s.step) {
      case "idle":
        if (text.length < 6) return send(chatId, "Опишите, что нужно сделать, или выберите пункт меню.", MAIN_KEYBOARD);
        newDraft(s, msg.from);
        return acceptDescription(chatId, text, s);
      case "describe":
        return acceptDescription(chatId, text, s);
      case "city":
        s.draft.city = dispatcher.normalizeCity(text);
        return ask(chatId, s);
      case "address":
        s.draft.address = text;
        return ask(chatId, s);
      case "when":
        s.draft.when = text.toLowerCase();
        if (/скорее|срочно|сейчас/.test(s.draft.when) && !s.draft.urgent) {
          s.draft.urgent = true;
          s.draft.estimate_rub = Math.round(s.draft.estimate_rub * 1.5);
        }
        return ask(chatId, s);
      case "phone": {
        const phone = dispatcher.normalizePhone(text);
        if (!phone) return send(chatId, "Не похоже на номер. Пример: +7 999 123-45-67", PHONE_KEYBOARD);
        s.draft.phone = phone;
        return ask(chatId, s);
      }
      case "confirm":
        return send(chatId, "Нажмите «Отправить заявку» в сообщении выше или «Отмена».");
    }
  }

  async function handleCallback(q) {
    const chatId = q.message?.chat?.id;
    const [action, arg] = String(q.data || "").split(":");
    const s = session(chatId);
    await api("answerCallbackQuery", { callback_query_id: q.id });

    if (action === "c_ok") {
      if (s.step !== "confirm" || !s.draft) return send(chatId, "Эта заявка уже отправлена или отменена.", MAIN_KEYBOARD);
      return submit(chatId, s);
    }
    if (action === "c_edit") return startDraft(chatId, q.from, s);
    if (action === "c_cancel") {
      reset(chatId);
      return send(chatId, "Заявка отменена.", MAIN_KEYBOARD);
    }
    if (action === "c_cancel_order") {
      const o = dispatcher.getOrder(arg);
      if (!o || o.clientChatId !== String(chatId)) return;
      if (!["new", "assigned"].includes(o.status)) return send(chatId, `Заявку №${o.id} уже нельзя отменить в боте, напишите оператору.`);
      dispatcher.setStatus(o, "cancelled", "Отменён клиентом");
      return send(chatId, `Заявка №${o.id} отменена.`, MAIN_KEYBOARD);
    }
    if (action === "rate") {
      const [id, stars] = arg.split("/").map(Number);
      const o = dispatcher.getOrder(id);
      if (!o || o.clientChatId !== String(chatId) || !(stars >= 1 && stars <= 5)) return;
      if (o.status !== "done") return send(chatId, "Оценить мастера можно после выполнения заявки.");
      if (!dispatcher.rateOrder(o, stars)) return send(chatId, "Спасибо, оценка уже учтена.");
      if (stars <= 3) await send(operatorChatId, `⚠️ Низкая оценка ${stars}/5 по заказу №${o.id}. Свяжитесь с клиентом.`);
      return send(chatId, stars >= 4 ? "Спасибо за оценку! Будем рады помочь снова." : "Спасибо. Нам жаль, что что-то пошло не так, оператор свяжется с вами.", MAIN_KEYBOARD);
    }
  }

  // ===== уведомления клиенту о ходе заказа =====
  dispatcher.onStatusChange(async (order, status, note) => {
    if (!order.clientChatId || note === "Отменён клиентом") return;
    const m = order.masterId ? dispatcher.getMaster(order.masterId) : null;
    if (status === "assigned" && m) {
      return send(order.clientChatId, `👷 На заявку №${order.id} назначен мастер ${m.name}${m.phone ? ", телефон +" + m.phone : ""}. Он свяжется с вами, чтобы уточнить время.`);
    }
    if (status === "in_work") return send(order.clientChatId, `🔧 Мастер приступил к заявке №${order.id}.`);
    if (status === "done") {
      return send(order.clientChatId, `✅ Заявка №${order.id} выполнена. Оцените, пожалуйста, работу мастера:`, {
        inline_keyboard: [[1, 2, 3, 4, 5].map(n => ({ text: `${n}⭐`, callback_data: `rate:${order.id}/${n}` }))]
      });
    }
    if (status === "cancelled") return send(order.clientChatId, `Заявка №${order.id} отменена. Если это ошибка — напишите нам.`, MAIN_KEYBOARD);
  });

  const CLIENT_CALLBACKS = ["c_ok", "c_edit", "c_cancel", "c_cancel_order", "rate"];

  return {
    enabled,
    // true, если апдейт обработал клиентский бот
    async handleUpdate(update) {
      if (update.message) {
        await handleMessage(update.message);
        return true;
      }
      if (update.callback_query && CLIENT_CALLBACKS.includes(String(update.callback_query.data).split(":")[0])) {
        await handleCallback(update.callback_query);
        return true;
      }
      return false;
    },
    api,
    lastError
  };
}

// режим без webhook: бот сам опрашивает Telegram (удобно для запуска на своём компьютере)
export async function startPolling(bot, handle) {
  await bot.api("deleteWebhook", {});
  let offset = 0;
  console.log("Telegram: long polling запущен");
  for (;;) {
    const updates = await bot.api("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
    if (!updates) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      try {
        await handle(u);
      } catch (e) {
        console.error("TG update error:", e.message);
      }
    }
  }
}
