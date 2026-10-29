import { execSync } from "child_process";
import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// ===================================================================
//  Прокси для запросов к Telegram.
//  Многие VPN-программы работают в режиме «системный прокси»: браузер и
//  Telegram идут через VPN, а Node.js — нет. Поэтому берём прокси из
//  TG_PROXY или, на Windows, из системных настроек прокси.
// ===================================================================

// "127.0.0.1:10809" или "http=127.0.0.1:10809;https=...;socks=127.0.0.1:10808"
function parseWindowsProxy(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (!v.includes("=")) return /^[a-z0-9]+:\/\//i.test(v) ? v : `http://${v}`;
  const parts = Object.fromEntries(v.split(";").map(p => p.split("=").map(s => s.trim())));
  if (parts.https) return `http://${parts.https}`;
  if (parts.http) return `http://${parts.http}`;
  if (parts.socks) return `socks5://${parts.socks}`;
  return "";
}

function windowsSystemProxy() {
  if (process.platform !== "win32") return "";
  try {
    const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"', {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x0*1\b/i.test(out);
    const server = (out.match(/ProxyServer\s+REG_SZ\s+(.+)/i) || [])[1];
    return enabled ? parseWindowsProxy(server) : "";
  } catch {
    return "";
  }
}

export function resolveProxy() {
  if (process.env.TG_PROXY === "off") return { url: "", source: "" };
  if (process.env.TG_PROXY) return { url: parseWindowsProxy(process.env.TG_PROXY), source: "TG_PROXY" };
  const sys = windowsSystemProxy();
  return { url: sys, source: sys ? "системный прокси Windows" : "" };
}

// настройки axios: агент для прокси и отключение встроенной (ненадёжной для https) поддержки прокси
// keepAlive: соединение с Telegram (и через VPN) открывается один раз, а не на каждое сообщение
export function proxyAxiosConfig(url) {
  if (!url) return { httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 20 }) };
  const opts = { keepAlive: true, maxSockets: 20 };
  const agent = url.startsWith("socks") ? new SocksProxyAgent(url, opts) : new HttpsProxyAgent(url, opts);
  return { httpsAgent: agent, httpAgent: agent, proxy: false };
}
