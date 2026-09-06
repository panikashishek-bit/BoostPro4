import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { DashboardEnv } from "./config";

// Доступ пульта к логу событий бота.
//
// Пульт ТОЛЬКО ЧИТАЕТ. База открывается с readOnly: попытка записи отбивается самим
// SQLite, а не нашей дисциплиной — пульт не должен иметь возможности испортить
// историю, даже если однажды кто-то добавит сюда неосторожный запрос.
//
// Соединение открывается и закрывается на КАЖДЫЙ запрос страницы: никакого кэша,
// нажал F5 — увидел то, что бот записал секунду назад. База локальная, это дёшево.
//
// Бот пишет в режиме WAL, поэтому читать можно прямо во время записи: читатель
// не блокирует писателя и наоборот. Проверено на живом писателе.

export const EVENTS_DB_VARIABLE = "EVENTS_DB_PATH";

export type EventsDbResult =
  | { ok: true; path: string; db: DatabaseSync }
  | { ok: false; path: string | null; problem: string };

/**
 * Открывает базу событий на чтение.
 *
 * Не бросает: пульт обязан уметь показать «базы нет» строкой, а не пятисотой —
 * иначе владелец не отличит «бот ещё не писал» от «пульт сломался».
 */
export function openEventsDb(env: DashboardEnv): EventsDbResult {
  const raw = env.get(EVENTS_DB_VARIABLE);
  if (!raw) {
    return { ok: false, path: null, problem: `переменная ${EVENTS_DB_VARIABLE} не задана в dashboard/.env` };
  }

  // Относительный путь считаем от корня проекта — там же, где его считает бот.
  // Поэтому в обоих .env стоит одинаковое «data/events.db».
  const path = resolve(process.cwd(), raw);

  try {
    return { ok: true, path, db: new DatabaseSync(path, { readOnly: true }) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || /unable to open/i.test(String((error as Error)?.message))) {
      return {
        ok: false,
        path,
        problem: `файла нет по пути ${path} — бот ещё не записал ни одного события или не доехала настройка`,
      };
    }
    return { ok: false, path, problem: `база не открывается: ${(error as Error)?.message ?? code}` };
  }
}

/** Число в таблице meta, куда бот кладёт свои фактические настройки. Нет строки — undefined. */
export function readMetaNumber(db: DatabaseSync, key: string): number | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value?: string }
    | undefined;
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : undefined;
}
