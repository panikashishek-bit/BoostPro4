// Память диалога: последние сообщения каждого чата Telegram.
//
// Хранится на диске, а не только в оперативной памяти. Причина конкретная:
// при перезапуске бота (правка кода, передеплой) клиент оказывался посреди записи
// с ботом, который «забыл», о какой услуге шла речь, и переспрашивал заново.
//
// ⚠️ В файле лежат имена и телефоны клиентов — он в .gitignore и не должен попадать в git.
// Переписка старше HISTORY_TTL_DAYS удаляется: хранить контакты дольше, чем нужно для записи, незачем.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { config } from "./config.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatRecord = { updatedAt: number; messages: ChatMessage[] };

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA_DIR, "history.json");
const HISTORY_TTL_DAYS = 7;

const chats = load();

function load(): Map<number, ChatRecord> {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, ChatRecord>;
    const cutoff = Date.now() - HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000;
    const fresh = Object.entries(raw).filter(([, rec]) => rec.updatedAt > cutoff);
    console.log(`[память] загружено чатов: ${fresh.length}`);
    return new Map(fresh.map(([id, rec]) => [Number(id), rec]));
  } catch (error) {
    // Файла ещё нет — обычное дело при первом запуске. Битый файл тоже не повод падать:
    // потерять историю неприятно, но не работать вовсе — хуже.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[память] не удалось прочитать историю, начинаю с пустой:", error);
    }
    return new Map();
  }
}

/** Пишет через временный файл: обрыв на середине не оставит после себя битый JSON. */
function save(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${FILE}.tmp`;
    writeFileSync(temp, JSON.stringify(Object.fromEntries(chats), null, 2), "utf8");
    renameSync(temp, FILE);
  } catch (error) {
    // Разговор важнее журнала: не смогли сохранить — работаем дальше на памяти процесса.
    console.error("[память] не удалось сохранить историю:", error);
  }
}

/** Возвращает историю чата (пустой массив, если её ещё нет). */
export function getHistory(chatId: number): ChatMessage[] {
  return chats.get(chatId)?.messages ?? [];
}

/** Дописывает сообщение и обрезает историю до последних config.historyLimit записей. */
export function remember(chatId: number, message: ChatMessage): void {
  const messages = [...getHistory(chatId), message].slice(-config.historyLimit);
  chats.set(chatId, { updatedAt: Date.now(), messages });
  save();
}

/** Забывает переписку чата — например, по команде /start. */
export function forget(chatId: number): void {
  chats.delete(chatId);
  save();
}
