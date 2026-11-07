import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

// ===================================================================
//  Сеть: все внешние запросы радара идут через этот клиент.
//  RADAR_PROXY=http://user:pass@host:port — прокси для всех запросов
//  (нужен, например, если Instagram/Reddit недоступны с сервера).
// ===================================================================

export const PROXY = process.env.RADAR_PROXY || "";
const agent = PROXY ? new HttpsProxyAgent(PROXY) : undefined;

export const http = axios.create({
  timeout: 20000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; GoPromoRadar/1.0)" },
  ...(agent ? { httpsAgent: agent, httpAgent: agent, proxy: false } : {})
});
