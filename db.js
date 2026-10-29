import fs from "fs";
import path from "path";

// ===== простое хранилище в JSON-файле (переживает перезапуск) =====
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const empty = () => ({ orders: [], masters: [], orderCounter: 1, masterCounter: 1 });

let state = empty();
let saveTimer = null;

export function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      state = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) };
    }
  } catch (e) {
    console.error("DB load error:", e.message);
  }
  return state;
}

export function db() {
  return state;
}

// запись с небольшой задержкой, чтобы не писать файл на каждое изменение
export function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error("DB save error:", e.message);
    }
  }, 200);
}
