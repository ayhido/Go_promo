// Сценарист: пишет сценарий рилса. С ключом Claude пишет новый под любую тему,
// без ключа берёт готовые сценарии из библиотеки.
import Anthropic from "@anthropic-ai/sdk";
import { LIBRARY } from "./library.js";
import { PALETTES } from "./palettes.js";

const PROPS = ["knot", "gem", "house", "hammer", "drop", "bolt", "heart", "star", "clock", "ruble"];
const TYPES = ["hook", "problem", "steps", "stat", "solution", "cta"];

export const hasAi = () => !process.env.AI_DISABLED && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "palette", "scenes", "caption", "hashtags"],
  properties: {
    title: { type: "string" },
    palette: { type: "string", enum: Object.keys(PALETTES) },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "say", "title", "items", "number", "prefix", "suffix", "prop", "button"],
        properties: {
          type: { type: "string", enum: TYPES },
          say: { type: "string" },
          title: { type: "string" },
          items: { type: "array", items: { type: "string" } },
          number: { type: "number" },
          prefix: { type: "string" },
          suffix: { type: "string" },
          prop: { type: "string", enum: PROPS },
          button: { type: "string" }
        }
      }
    }
  }
};

const SYSTEM = `Ты сценарист вирусных Reels на русском. Пишешь так, будто говорит живой, тёплый, весёлый человек, а не робот и не реклама.

Правила:
- Первая сцена (hook) цепляет за 2 секунды: вопрос, узнаваемая боль, интрига, неожиданная цифра или мини-история. Никаких «Привет, сегодня расскажу».
- Эмоции: юмор, узнавание («это же я»), облегчение, гордость, тепло. Общий тон позитивный, финал всегда светлый.
- Короткие разговорные фразы, обращение на «ты», живые слова, можно лёгкий сленг. Без канцелярита и штампов («качественно», «профессионалы своего дела», «индивидуальный подход»).
- Конкретика: цифры, время, ситуации из жизни.
- 4–6 сцен, весь голос 55–85 слов (ролик 20–30 секунд). В одной сцене say не больше 22 слов.
- Типы сцен: hook (крючок), problem (боль), steps (2–4 пункта в items, каждый до 5 слов), stat (большая цифра в number, prefix/suffix вроде "от " и " ₽"), solution (облегчение, результат), cta (призыв: подписаться, написать кодовое слово в директ, сохранить или отправить другу). Первая всегда hook, последняя всегда cta.
- title: крупная надпись на экране, до 6 слов, не повторяет say дословно, а усиливает его.
- prop: 3D-предмет сцены из списка ${PROPS.join(", ")}; подбирай по смыслу.
- button: текст кнопки для cta (до 3 слов, капсом), для остальных сцен пустая строка. Неиспользуемые поля: items [], number 0, prefix "", suffix "".
- Числа в say пиши словами, чтобы голос читал естественно.
- palette: настроение (${Object.keys(PALETTES).join(", ")}).
- caption: подпись к посту, 2–4 коротких абзаца, 2–4 эмодзи, в конце призыв. hashtags: 5–8 штук без #.
- Не обещай того, чего нет в брифе (сроки, гарантии, цены), если бриф этого не даёт.`;

let client = null;

async function aiScript({ topic, niche, brand, avoid = [] }) {
  client ??= new Anthropic();
  const user = [
    `Ниша/бизнес: ${niche}`,
    brand?.name ? `Бренд: ${brand.name} ${brand.handle || ""}` : "",
    `Тема ролика: ${topic || "придумай сам самую цепляющую тему для этой ниши"}`,
    avoid.length ? `Уже были ролики (не повторяйся): ${avoid.slice(-20).join("; ")}` : ""
  ].filter(Boolean).join("\n");
  const response = await client.beta.messages.create({
    model: process.env.AI_MODEL || "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: user }]
  });
  if (response.stop_reason === "refusal") throw new Error("AI refusal");
  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("AI empty response");
  return normalize(JSON.parse(block.text));
}

export function normalize(s) {
  const scenes = (s.scenes || []).filter((x) => x && x.say).map((x) => ({
    type: TYPES.includes(x.type) ? x.type : "solution",
    say: String(x.say).trim(),
    title: String(x.title || "").trim(),
    items: (x.items || []).filter(Boolean).slice(0, 4),
    number: Number(x.number) || 0,
    prefix: x.prefix || "",
    suffix: x.suffix || "",
    prop: PROPS.includes(x.prop) ? x.prop : undefined,
    button: x.button || ""
  }));
  if (!scenes.length) throw new Error("пустой сценарий");
  if (scenes[0].type !== "hook") scenes[0].type = "hook";
  for (const sc of scenes) if (sc.type === "steps" && !sc.items.length) sc.type = "solution";
  return {
    title: s.title || scenes[0].title,
    palette: PALETTES[s.palette] ? s.palette : "sunrise",
    scenes,
    caption: s.caption || "",
    hashtags: (s.hashtags || []).map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10),
    key: s.key
  };
}

// Сценарий без ИИ по произвольной теме (запасной вариант, проще библиотечных).
function templateScript(topic) {
  const t = topic.replace(/[.!?]+$/, "");
  return normalize({
    title: t,
    palette: ["sunrise", "ocean", "mint", "neon", "gold"][Math.floor(Math.random() * 5)],
    scenes: [
      { type: "hook", say: `${t}? Сейчас за двадцать секунд разберёмся.`, title: t, prop: "knot" },
      { type: "problem", say: "Обычно это откладывают до последнего, а потом становится только хуже.", title: "Откладывать — дороже", prop: "clock" },
      { type: "solution", say: "Один звонок, и мастер приедет со своим инструментом и всё сделает аккуратно.", title: "Один звонок — и готово", prop: "star" },
      { type: "cta", say: "Пиши «мастер» в директ, подскажем по твоей ситуации.", title: "Пиши «МАСТЕР» в директ", button: "НАПИСАТЬ «МАСТЕР»" }
    ],
    caption: `${t} 👇\n\nПиши «МАСТЕР» в директ, подскажем.`,
    hashtags: ["мастерначас", "ремонт", "дом"]
  });
}

/**
 * Возвращает сценарий. used — ключи/заголовки уже сделанных роликов.
 */
export async function writeScript({ topic = "", niche, brand, used = [] }) {
  if (hasAi()) {
    try {
      return { ...(await aiScript({ topic, niche, brand, avoid: used })), by: "claude" };
    } catch (e) {
      console.error("[writer] Claude недоступен, беру библиотеку:", e.message);
    }
  }
  if (topic) {
    const hit = LIBRARY.find((l) => l.title.toLowerCase().includes(topic.toLowerCase()) || l.key === topic);
    if (hit) return { ...normalize(hit), by: "library" };
    return { ...templateScript(topic), by: "template" };
  }
  const fresh = LIBRARY.filter((l) => !used.includes(l.key) && !used.includes(l.title));
  const pool = fresh.length ? fresh : LIBRARY;
  return { ...normalize(pool[Math.floor(Math.random() * pool.length)]), by: "library" };
}

export const libraryList = () => LIBRARY.map((l) => ({ key: l.key, title: l.title, scenes: l.scenes.length }));
