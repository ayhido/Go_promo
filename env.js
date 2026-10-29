import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ===== настройки из файла .env рядом с server.js (работает на Windows, Mac и Linux) =====
// формат строк: ИМЯ=значение; строки с # — комментарии; переменные окружения важнее файла
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");

try {
  const text = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  console.log("Настройки загружены из .env");
} catch (e) {
  if (e.code !== "ENOENT") console.error(".env read error:", e.message);
}
