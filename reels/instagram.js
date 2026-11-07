// Публикация Reels через Instagram Graph API (профессиональный аккаунт).
// Видео заливается напрямую (resumable upload), публичный URL не нужен.
import fs from "fs";
import axios from "axios";

const cfg = () => ({
  token: process.env.IG_ACCESS_TOKEN,
  userId: process.env.IG_USER_ID,
  // graph.facebook.com — для токена через Facebook Login; graph.instagram.com — для Instagram Login
  host: process.env.IG_GRAPH_HOST || "graph.facebook.com",
  ver: process.env.IG_API_VERSION || "v21.0"
});

export const instagramReady = () => Boolean(cfg().token && cfg().userId);

const api = (path) => { const c = cfg(); return `https://${c.host}/${c.ver}/${path}`; };
const errText = (e) => e.response?.data?.error?.message || e.message;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publishReel({ file, caption, coverOffsetMs = 1000, onStatus = () => {} }) {
  const c = cfg();
  if (!instagramReady()) throw new Error("Instagram не подключён: задайте IG_USER_ID и IG_ACCESS_TOKEN");
  try {
    onStatus("создаю контейнер в Instagram");
    const { data: created } = await axios.post(api(`${c.userId}/media`), null, {
      params: { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: true, thumb_offset: coverOffsetMs, access_token: c.token }
    });
    const containerId = created.id;
    const uploadUri = created.uri || `https://rupload.facebook.com/ig-api-upload/${c.ver}/${containerId}`;

    onStatus("заливаю видео");
    const size = fs.statSync(file).size;
    await axios.post(uploadUri, fs.createReadStream(file), {
      headers: { Authorization: `OAuth ${c.token}`, offset: "0", file_size: String(size), "Content-Type": "application/octet-stream" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 10 * 60 * 1000
    });

    onStatus("Instagram обрабатывает видео");
    for (let i = 0; i < 60; i++) {
      const { data } = await axios.get(api(containerId), { params: { fields: "status_code,status", access_token: c.token } });
      if (data.status_code === "FINISHED") break;
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") throw new Error(`обработка не прошла: ${data.status || data.status_code}`);
      await sleep(5000);
    }

    onStatus("выкладываю в Instagram");
    const { data: pub } = await axios.post(api(`${c.userId}/media_publish`), null, { params: { creation_id: containerId, access_token: c.token } });

    onStatus("проверяю, как вышел пост");
    let permalink = null;
    try {
      const { data } = await axios.get(api(pub.id), { params: { fields: "permalink", access_token: c.token } });
      permalink = data.permalink;
    } catch {}
    return { mediaId: pub.id, permalink };
  } catch (e) {
    throw new Error(errText(e));
  }
}

// Замеры: просмотры, охват, лайки, комментарии, сохранения, репосты.
export async function reelInsights(mediaId) {
  const c = cfg();
  const metrics = ["views", "reach", "likes", "comments", "saved", "shares"];
  const { data } = await axios.get(api(`${mediaId}/insights`), { params: { metric: metrics.join(","), access_token: c.token } }).catch((e) => { throw new Error(errText(e)); });
  const out = {};
  for (const m of data.data || []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
  return out;
}
