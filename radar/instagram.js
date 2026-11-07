import { http } from "./net.js";

// ===================================================================
//  Публикация рилса в Instagram через официальный Graph API.
//  Нужно: профессиональный аккаунт (Бизнес/Автор), приложение Meta
//  с правом instagram_content_publish и долгоживущий токен.
//  Видео Instagram скачивает сам по ссылке, поэтому сервер должен быть
//  доступен из интернета по PUBLIC_URL.
// ===================================================================

const HOST = process.env.IG_GRAPH_HOST || "graph.facebook.com"; // или graph.instagram.com для «Instagram Login»
const VER = process.env.IG_API_VERSION || "v21.0";
const api = p => `https://${HOST}/${VER}/${p}`;

export function igStatus() {
  const missing = ["IG_USER_ID", "IG_ACCESS_TOKEN", "PUBLIC_URL"].filter(k => !process.env[k]);
  return { ready: missing.length === 0, missing };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function igError(e) {
  const msg = e.response?.data?.error?.message;
  return new Error(msg ? `Instagram: ${msg}` : e.message);
}

export async function publishReel({ videoUrl, caption }) {
  const { ready, missing } = igStatus();
  if (!ready) throw new Error("Instagram не настроен: нет " + missing.join(", "));
  const token = process.env.IG_ACCESS_TOKEN;
  const user = process.env.IG_USER_ID;

  try {
    // 1. контейнер: Instagram скачивает и обрабатывает видео
    const { data: container } = await http.post(api(`${user}/media`), null, {
      params: { media_type: "REELS", video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: true, access_token: token }
    });

    // 2. ждём обработку (обычно 30 сек – 2 мин)
    for (let i = 0; i < 40; i++) {
      await sleep(8000);
      const { data } = await http.get(api(container.id), { params: { fields: "status_code,status", access_token: token } });
      if (data.status_code === "FINISHED") break;
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") throw new Error(`Instagram не принял видео: ${data.status || data.status_code}`);
      if (i === 39) throw new Error("Instagram слишком долго обрабатывает видео, попробуйте позже");
    }

    // 3. публикация
    const { data: pub } = await http.post(api(`${user}/media_publish`), null, { params: { creation_id: container.id, access_token: token } });
    let permalink = "";
    try {
      permalink = (await http.get(api(pub.id), { params: { fields: "permalink", access_token: token } })).data.permalink || "";
    } catch {}
    return { mediaId: pub.id, permalink };
  } catch (e) {
    throw e.response ? igError(e) : e;
  }
}
