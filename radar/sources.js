import { XMLParser } from "fast-xml-parser";
import { http } from "./net.js";

// ===================================================================
//  Источники. Каждый возвращает массив сырых находок:
//  { id, source, sourceName, kind, title, url, summary, publishedAt, engagement }
//  kind подсказывает раздел: idea | business | invest | content | trend | news
// ===================================================================

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const strip = s =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const text = v => (v && typeof v === "object" ? v["#text"] ?? "" : v ?? "");
const arr = v => (Array.isArray(v) ? v : v ? [v] : []);
const time = v => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : Date.now();
};

// ---------- RSS / Atom ----------
async function rss(source, url, kind, extra = {}) {
  const { data } = await http.get(url, { responseType: "text" });
  const doc = xml.parse(data);
  const rssItems = arr(doc?.rss?.channel?.item);
  const atomItems = arr(doc?.feed?.entry);

  const items = rssItems.map(it => ({
    title: strip(text(it.title)),
    url: text(it.link) || text(it.guid),
    summary: strip(
      text(it.description) || arr(it["ht:news_item"]).map(n => text(n["ht:news_item_title"])).join(" · ")
    ).slice(0, 600),
    publishedAt: time(it.pubDate || it["dc:date"]),
    engagement: Number(it["ht:approx_traffic"]?.toString().replace(/\D/g, "")) || 0,
    raw: it
  }));
  for (const it of atomItems) {
    const link = arr(it.link).find(l => !l["@rel"] || l["@rel"] === "alternate") || arr(it.link)[0];
    items.push({
      title: strip(text(it.title)),
      url: link?.["@href"] || "",
      summary: strip(text(it.summary) || text(it.content) || text(it["media:group"]?.["media:description"])).slice(0, 600),
      publishedAt: time(it.published || it.updated),
      engagement: Number(it["media:group"]?.["media:community"]?.["media:statistics"]?.["@views"]) || 0,
      raw: it
    });
  }

  // у Google Trends ссылка у всех элементов одна — тогда ключом служит заголовок
  const urls = items.map(i => i.url);
  const generic = new Set(urls.filter((u, k) => urls.indexOf(u) !== k));
  return items
    .filter(i => i.title && i.url)
    .map(({ raw, ...i }) => ({
      id: `${source}:${generic.has(i.url) ? i.title.toLowerCase() : i.url}`,
      source,
      sourceName: extra.name || source,
      kind,
      ...i
    }));
}

// ---------- Hacker News (Show HN = новые продукты и проекты) ----------
async function hackerNews() {
  const { data } = await http.get("https://hn.algolia.com/api/v1/search_by_date", {
    params: { tags: "show_hn", hitsPerPage: 60, numericFilters: "points>15" }
  });
  return data.hits.map(h => ({
    id: `hn:${h.objectID}`,
    source: "hn",
    sourceName: "Hacker News · Show HN",
    kind: "business",
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    summary: strip(h.story_text).slice(0, 600),
    publishedAt: h.created_at_i * 1000,
    engagement: (h.points || 0) + (h.num_comments || 0)
  }));
}

// ---------- Reddit (часто блокирует серверы — тогда нужен прокси) ----------
const SUBREDDITS = ["sidehustle", "Entrepreneur", "passive_income", "smallbusiness", "EntrepreneurRideAlong", "SaaS", "ecommerce"];
async function reddit() {
  const out = [];
  for (const sub of SUBREDDITS) {
    const { data } = await http.get(`https://www.reddit.com/r/${sub}/top.json`, { params: { t: "day", limit: 15 } });
    for (const { data: p } of data.data.children) {
      if (p.stickied) continue;
      out.push({
        id: `reddit:${p.id}`,
        source: "reddit",
        sourceName: `Reddit · r/${sub}`,
        kind: "idea",
        title: p.title,
        url: `https://www.reddit.com${p.permalink}`,
        summary: strip(p.selftext).slice(0, 600),
        publishedAt: p.created_utc * 1000,
        engagement: (p.score || 0) + (p.num_comments || 0)
      });
    }
  }
  return out;
}

// ---------- CoinGecko: что сейчас ищут в крипте ----------
async function coingecko() {
  const { data } = await http.get("https://api.coingecko.com/api/v3/search/trending");
  return data.coins.map(({ item: c }) => {
    const ch = c.data?.price_change_percentage_24h?.usd;
    return {
      id: `cg:${c.id}:${new Date().toISOString().slice(0, 10)}`,
      source: "coingecko",
      sourceName: "CoinGecko · тренды",
      kind: "invest",
      title: `${c.name} (${c.symbol}) в трендах крипты${Number.isFinite(ch) ? `, ${ch > 0 ? "+" : ""}${ch.toFixed(1)}% за 24ч` : ""}`,
      url: `https://www.coingecko.com/coins/${c.id}`,
      summary: `Ранг по капитализации: ${c.market_cap_rank ?? "—"}. Высокий интерес не означает рост: проверьте ликвидность и проект.`,
      publishedAt: Date.now(),
      engagement: Math.max(0, 100 - (c.score || 0) * 10)
    };
  });
}

// ---------- YouTube (нужен YT_API_KEY): что снимают и что набирает просмотры ----------
const YT_QUERIES = ["как заработать", "бизнес идея", "side hustle", "make money online", "куда инвестировать"];
async function youtube() {
  const key = process.env.YT_API_KEY;
  if (!key) return [];
  const after = new Date(Date.now() - 3 * 864e5).toISOString();
  const out = [];
  for (const q of YT_QUERIES) {
    const { data } = await http.get("https://www.googleapis.com/youtube/v3/search", {
      params: { key, q, part: "snippet", type: "video", order: "viewCount", publishedAfter: after, maxResults: 10, videoDuration: "short" }
    });
    const ids = data.items.map(i => i.id.videoId).join(",");
    const stats = ids
      ? (await http.get("https://www.googleapis.com/youtube/v3/videos", { params: { key, id: ids, part: "statistics" } })).data.items
      : [];
    const views = new Map(stats.map(s => [s.id, Number(s.statistics.viewCount) || 0]));
    for (const i of data.items) {
      out.push({
        id: `yt:${i.id.videoId}`,
        source: "youtube",
        sourceName: `YouTube Shorts · «${q}»`,
        kind: "content",
        title: strip(i.snippet.title),
        url: `https://www.youtube.com/shorts/${i.id.videoId}`,
        summary: strip(i.snippet.description).slice(0, 400) + ` · канал ${i.snippet.channelTitle}`,
        publishedAt: time(i.snippet.publishedAt),
        engagement: views.get(i.id.videoId) || 0
      });
    }
  }
  return out;
}

// ---------- реестр ----------
export const SOURCES = [
  { key: "hn", name: "Hacker News · Show HN", run: hackerNews },
  { key: "producthunt", name: "Product Hunt", run: () => rss("producthunt", "https://www.producthunt.com/feed", "business", { name: "Product Hunt" }) },
  { key: "trends_ru", name: "Google Trends · Россия", run: () => rss("trends_ru", "https://trends.google.com/trending/rss?geo=RU", "trend", { name: "Google Trends · RU" }) },
  { key: "trends_us", name: "Google Trends · США", run: () => rss("trends_us", "https://trends.google.com/trending/rss?geo=US", "trend", { name: "Google Trends · US" }) },
  { key: "vc", name: "vc.ru", run: () => rss("vc", "https://vc.ru/rss", "news", { name: "vc.ru" }) },
  { key: "rb", name: "RB.ru", run: () => rss("rb", "https://rb.ru/feeds/all/", "news", { name: "RB.ru" }) },
  { key: "habr", name: "Хабр · Стартапы", run: () => rss("habr", "https://habr.com/ru/rss/hubs/startuprise/articles/", "business", { name: "Хабр · Стартапы" }) },
  { key: "techcrunch", name: "TechCrunch", run: () => rss("techcrunch", "https://techcrunch.com/feed/", "news", { name: "TechCrunch" }) },
  { key: "entrepreneur", name: "Entrepreneur", run: () => rss("entrepreneur", "https://feeds.feedburner.com/entrepreneur/latest", "idea", { name: "Entrepreneur" }) },
  { key: "coingecko", name: "CoinGecko · тренды", run: coingecko },
  { key: "reddit", name: "Reddit (подработка, бизнес)", run: reddit },
  { key: "youtube", name: "YouTube Shorts (нужен YT_API_KEY)", run: youtube }
];

// Свои RSS: RADAR_EXTRA_RSS="Название|https://site/rss|kind;Другой|https://..."
for (const part of (process.env.RADAR_EXTRA_RSS || "").split(";").filter(Boolean)) {
  const [name, url, kind = "news"] = part.split("|").map(s => s.trim());
  if (!url) continue;
  const key = "rss_" + name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "_");
  SOURCES.push({ key, name, run: () => rss(key, url, kind, { name }) });
}
