import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ===================================================================
//  Безопасность: вход в панель по паролю, защита от подбора,
//  ограничение частоты запросов с публичного сайта, заголовки.
// ===================================================================

const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
const COOKIE = "gp_session";
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7; // неделя
const sessions = new Map(); // token -> expiresAt

// пароль из ADMIN_PASSWORD; если его нет — придумываем и дописываем в .env
function ensurePassword() {
  if (process.env.ADMIN_PASSWORD) return { password: process.env.ADMIN_PASSWORD, generated: false };
  const password = crypto.randomBytes(9).toString("base64url");
  process.env.ADMIN_PASSWORD = password;
  try {
    fs.appendFileSync(ENV_FILE, `\nADMIN_PASSWORD=${password}\n`);
  } catch (e) {
    console.error("Не удалось записать пароль в .env:", e.message);
  }
  return { password, generated: true };
}

const sha = s => crypto.createHash("sha256").update(String(s)).digest();
const samePassword = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// ===== простой ограничитель частоты по ключу (обычно IP) =====
export function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return {
    // true, если лимит превышен
    hit(key) {
      const now = Date.now();
      const v = hits.get(key);
      if (!v || v.reset < now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return false;
      }
      v.count++;
      return v.count > max;
    },
    blocked(key) {
      const v = hits.get(key);
      return Boolean(v && v.reset >= Date.now() && v.count >= max);
    },
    reset(key) {
      hits.delete(key);
    }
  };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLoggedIn(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// пути, доступные без входа: публичный сайт, вход, Telegram
const PUBLIC = [
  /^\/$/, /^\/site\.html$/, /^\/login(\.html)?$/, /^\/api\/login$/, /^\/api\/public\//,
  /^\/js\//, /^\/vendor\//, /^\/telegram-webhook$/, /^\/favicon\.ico$/
];

export function setupSecurity(app) {
  const { password, generated } = ensurePassword();
  if (generated) {
    console.log("\n================================================");
    console.log(" Пароль для входа в панель диспетчера:");
    console.log(`   ${password}`);
    console.log(" Он сохранён в файле .env (строка ADMIN_PASSWORD).");
    console.log("================================================\n");
  }

  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "1");

  // заголовки безопасности
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(), geolocation=()"
    });
    next();
  });

  const loginLimiter = rateLimiter({ max: 8, windowMs: 15 * 60 * 1000 });

  app.post("/api/login", (req, res) => {
    const ip = req.ip;
    if (loginLimiter.blocked(ip)) {
      return res.status(429).json({ error: "Слишком много попыток. Подождите 15 минут." });
    }
    if (!samePassword(req.body?.password || "", password)) {
      loginLimiter.hit(ip);
      console.log(`Неудачная попытка входа с ${ip}`);
      return res.status(401).json({ error: "Неверный пароль" });
    }
    loginLimiter.reset(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL);
    const secure = req.secure ? "; Secure" : "";
    res.set("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) sessions.delete(token);
    res.set("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // всё, что не публично, — только после входа
  app.use((req, res, next) => {
    if (PUBLIC.some(re => re.test(req.path)) || isLoggedIn(req)) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Нужно войти" });
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  });
}
