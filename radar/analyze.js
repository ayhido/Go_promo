import Anthropic from "@anthropic-ai/sdk";

// ===================================================================
//  Анализ находок: раздел, оценка «денежности» 0–100, риск,
//  и (с ключом Claude) разбор «как на этом заработать» + сценарий рилса.
// ===================================================================

export const CATEGORIES = {
  idea: "Идеи заработка",
  business: "Бизнес и продукты",
  invest: "Инвестиции",
  content: "Рилсы и контент",
  trend: "Тренды",
  news: "Новости рынка"
};

const WORDS = {
  money: [
    "заработ", "доход", "прибыл", "выручк", "деньг", "миллион", "монетиз", "подработ", "фриланс", "продаж", "клиент",
    "revenue", "profit", "income", "mrr", "arr", "$", "money", "earn", "paid", "customers", "side hustle", "sales", "₽"
  ],
  business: [
    "бизнес", "стартап", "франшиз", "маркетплейс", "wildberries", "ozon", "магазин", "производств", "сервис", "запуст",
    "startup", "saas", "launch", "show hn", "founder", "bootstrap", "ecommerce", "shopify", "agency", "niche", "product"
  ],
  invest: [
    "инвест", "акци", "облигац", "дивиденд", "вклад", "ставк", "ipo", "биткоин", "крипт", "фонд", "недвижим", "золот",
    "invest", "stock", "bond", "etf", "bitcoin", "crypto", "dividend", "real estate", "funding", "raises", "valuation"
  ],
  content: [
    "рилс", "reels", "tiktok", "тикток", "shorts", "youtube", "блог", "instagram", "инстаграм", "контент", "telegram-канал",
    "viral", "creator", "influencer", "ugc", "подписчик", "followers", "views", "просмотр"
  ],
  ai: ["ии", "нейросет", "ai", "gpt", "claude", "llm", "agent", "агент", "автоматиз", "automation"]
};

// признаки схем и обещаний «лёгких денег» — такие находки помечаются как риск
const RISK = [
  "гарантирован", "без вложений", "без риска", "пассивный доход от", "схема заработка", "иксы", "x100", "x10 ", "сигналы",
  "казино", "ставки на спорт", "пирамид", "быстрые деньги", "100% прибыль", "guaranteed", "get rich", "pump", "airdrop", "memecoin"
];

// слово ищется с начала слова: «ии» не должно находиться внутри «капитализации»
const reCache = new Map();
const has = (s, w) => {
  w = w.toLowerCase().trim();
  if (!w) return false;
  if (!/^[\p{L}\p{N}]/u.test(w)) return s.includes(w);
  if (!reCache.has(w)) reCache.set(w, new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"));
  return reCache.get(w).test(s);
};
const count = (s, list) => list.reduce((n, w) => n + (has(s, w) ? 1 : 0), 0);

export function classify(item, settings = {}) {
  const s = ` ${item.title} ${item.summary} `.toLowerCase();
  const hits = {
    money: count(s, WORDS.money),
    business: count(s, WORDS.business),
    invest: count(s, WORDS.invest),
    content: count(s, WORDS.content),
    ai: count(s, WORDS.ai)
  };

  let category = item.kind === "news" ? "news" : item.kind;
  if (item.kind !== "trend") {
    const best = ["invest", "content", "business"].sort((a, b) => hits[b] - hits[a])[0];
    if (hits[best] > 0 && (item.kind === "news" || hits[best] >= 2)) category = best;
    if (hits.money >= 2 && category === "news") category = "idea";
  }

  // оценка: «денежные» слова + вовлечённость + свежесть + ваши ключевые слова
  let score = 15 + Math.min(30, hits.money * 8) + Math.min(20, (hits.business + hits.invest + hits.content) * 5) + Math.min(10, hits.ai * 5);
  if (item.engagement > 0) score += Math.min(20, Math.log10(item.engagement + 1) * 6);
  const ageH = (Date.now() - item.publishedAt) / 36e5;
  if (ageH < 6) score += 8;
  else if (ageH > 72) score -= 10;
  // тренд поиска сам по себе не про деньги: высоко только если в нём есть «денежные» слова
  if (item.kind === "trend") score = Math.min(score, 30 + hits.money * 12 + (hits.business + hits.invest) * 6);

  const mine = (settings.keywords || []).filter(k => k && has(s, k));
  score += mine.length * 15;

  const risk = RISK.filter(w => has(s, w));
  return {
    category,
    score: Math.max(0, Math.min(100, Math.round(score))),
    matched: mine,
    risk: risk.length ? `Похоже на обещание лёгких денег (${risk.slice(0, 3).join(", ")}). Проверьте, прежде чем вкладывать.` : ""
  };
}

// ---------- сценарий рилса без ИИ ----------
function wrapPoints(text, max = 3) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20)
    .slice(0, max)
    .map(s => (s.length > 120 ? s.slice(0, 117) + "…" : s));
}

const HOOKS = {
  idea: "Вот на чём сейчас зарабатывают 👇",
  business: "Новый продукт, который уже набирает клиентов",
  invest: "Куда смотрят инвесторы прямо сейчас",
  content: "Этот формат сейчас собирает просмотры",
  trend: "Это сейчас ищут тысячи людей",
  news: "Новость, которую можно превратить в деньги"
};

export function ruleReel(item) {
  const points = wrapPoints(item.summary);
  const slides = [item.title.length > 110 ? item.title.slice(0, 107) + "…" : item.title, ...points];
  if (slides.length < 3) slides.push("Как использовать: найдите, кому это нужно в вашем городе или нише, и предложите услугу");
  return {
    hook: HOOKS[item.category] || HOOKS.news,
    slides,
    cta: "Сохраняй и подписывайся — каждый день новая идея",
    caption: `${HOOKS[item.category] || ""}\n\n${item.title}\n\nИсточник: ${item.sourceName}`,
    hashtags: ["#заработок", "#бизнесидеи", "#идеидлябизнеса", "#деньги", "#тренды"],
    shooting: "Говорящая голова на фоне экрана с источником, 3–5 сек на мысль, субтитры крупно, в конце призыв сохранить."
  };
}

// ---------- разбор через Claude ----------
const hasAiKey = () => !process.env.AI_DISABLED && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const aiEnabled = hasAiKey;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title_ru: { type: "string" },
          category: { type: "string", enum: Object.keys(CATEGORIES) },
          money_score: { type: "integer" },
          how_to_earn: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          start_cost: { type: "string" },
          difficulty: { type: "string", enum: ["легко", "средне", "сложно"] },
          risk: { type: "string" },
          reel: {
            type: "object",
            properties: {
              hook: { type: "string" },
              slides: { type: "array", items: { type: "string" } },
              cta: { type: "string" },
              caption: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
              shooting: { type: "string" }
            },
            required: ["hook", "slides", "cta", "caption", "hashtags", "shooting"],
            additionalProperties: false
          }
        },
        required: ["id", "title_ru", "category", "money_score", "how_to_earn", "steps", "start_cost", "difficulty", "risk", "reel"],
        additionalProperties: false
      }
    }
  },
  required: ["items"],
  additionalProperties: false
};

const SYSTEM =
  "Ты аналитик возможностей заработка для начинающего предпринимателя и автора коротких видео в России. " +
  "Для каждой находки: переведи заголовок на русский; оцени 0–100, насколько реально на этом заработать обычному человеку в ближайшие месяцы " +
  "(общие новости, политика, спорт, светская хроника — ниже 20); объясни конкретный способ заработка (услуга, перепродажа, контент, продукт, вложение); " +
  "дай 3 первых шага, стартовый бюджет и сложность. В risk честно укажи риски и признаки мошенничества, а для инвестиций — что это не индивидуальная рекомендация. " +
  "Не обещай доход и не выдумывай цифр, которых нет в находке. " +
  "Сценарий рилса 20–30 секунд: hook — первые 2 секунды, цепляющий, без кликбейта-лжи; slides — 3–5 коротких фраз до 90 символов для текста на экране; " +
  "cta — призыв; caption — подпись для Instagram до 600 символов; 5–8 хэштегов; shooting — как снять (кадры, место, монтаж).";

let client = null;
export async function enrichWithAi(items) {
  if (!hasAiKey() || !items.length) return [];
  client ??= new Anthropic();
  const payload = items.map(i => ({ id: i.id, source: i.sourceName, title: i.title, summary: i.summary.slice(0, 500), engagement: i.engagement }));
  const response = await client.beta.messages.create({
    model: process.env.AI_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(payload) }]
  });
  if (response.stop_reason === "refusal") throw new Error("AI refusal");
  const block = response.content.find(b => b.type === "text");
  if (!block) throw new Error("AI empty response");
  return JSON.parse(block.text).items;
}
