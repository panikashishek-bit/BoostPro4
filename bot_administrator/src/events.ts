import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import { moment } from "./date.js";

// Лог событий бота в SQLite. Отвечает на вопрос «когда это было» — таблица «Клиенты»
// показывает обращения, но не даёт разложить их по времени и посчитать воронку.
//
// Правило номер один: НИЧЕГО ОТСЮДА НЕ ДОЛЖНО РОНЯТЬ БОТА. Лог — служебная запись,
// а на другом конце живой клиент ждёт ответа. Поэтому здесь нет ни одного throw:
// любая беда гасится, пишется в консоль один раз и забывается. Бот продолжает
// разговаривать так, будто лога нет вовсе.
//
// Персональных данных здесь не бывает: только chat_id, никаких имён и телефонов.
// Текст переписки тоже не пишем — в details у message_in лежит канал («текст»/«голос»),
// потому что сам текст сплошь и рядом содержит имя и номер, который клиент диктует боту.

export type EventName =
  /** Первое сообщение нового обращения. */
  | "session_start"
  /** Клиент прислал сообщение. */
  | "message_in"
  /** Целевое действие: клиент записан (J3, успешный create_booking). */
  | "session_success"
  /** Бот не смог ответить. */
  | "error";

type Fields = {
  sessionId: string;
  chatId: number;
  details?: string;
};

let db: DatabaseSync | null = null;
/** Один раз сломались — больше не пытаемся и не засоряем лог одинаковыми жалобами. */
let broken = false;

/**
 * Открывает базу при первой записи и создаёт схему, если её нет.
 *
 * Лениво, а не при импорте: нехватка базы не должна мешать боту стартовать
 * и отвечать клиентам.
 */
function connect(): DatabaseSync | null {
  if (db) return db;
  if (broken || !config.eventsDbPath) return null;

  try {
    mkdirSync(dirname(config.eventsDbPath), { recursive: true });
    const opened = new DatabaseSync(config.eventsDbPath);

    // WAL: бот пишет, пульт читает одновременно. Без него читающий блокировал бы
    // пишущего, и запись события ждала бы открытую страницу пульта.
    opened.exec("PRAGMA journal_mode = WAL");
    // Если база всё-таки занята — подождать, а не падать сразу.
    opened.exec("PRAGMA busy_timeout = 3000");

    opened.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT NOT NULL,
        session_id TEXT NOT NULL,
        chat_id    TEXT NOT NULL,
        event      TEXT NOT NULL,
        details    TEXT NOT NULL DEFAULT '',
        gist       TEXT NOT NULL DEFAULT '',
        is_demo    TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS events_ts_idx      ON events (ts);
      CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id);

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    db = opened;
    console.log(`[события] пишу в ${config.eventsDbPath}`);
    return db;
  } catch (error) {
    broken = true;
    console.error("[события] лог событий недоступен, бот работает без него:", error);
    return null;
  }
}

/**
 * Записывает событие. Возвращает id строки — он нужен только session_start,
 * чтобы позже дописать в неё gist.
 *
 * is_demo бот всегда оставляет пустым: пометка понадобится позже, и ставить её
 * будет не он.
 */
export function logEvent(event: EventName, fields: Fields): number | null {
  const database = connect();
  if (!database) return null;

  try {
    const result = database
      .prepare(
        `INSERT INTO events (ts, session_id, chat_id, event, details, gist, is_demo)
         VALUES (?, ?, ?, ?, ?, '', '')`
      )
      .run(moment(Date.now()), fields.sessionId, String(fields.chatId), event, fields.details ?? "");
    return Number(result.lastInsertRowid);
  } catch (error) {
    console.error(`[события] не записал ${event}:`, error);
    return null;
  }
}

/**
 * Дописывает gist в уже созданную строку session_start.
 *
 * Единственное место, где лог не только дописывает: поле мы сами оставили пустым
 * секунду назад и заполняем его же. Чужих строк и чужих полей это не касается —
 * иначе пришлось бы либо задержать клиента на время похода в модель, либо потерять
 * начало обращения, если бот упадёт до ответа.
 */
export function setGist(eventId: number, gist: string): void {
  const database = connect();
  if (!database || !gist) return;

  try {
    database.prepare("UPDATE events SET gist = ? WHERE id = ?").run(gist, eventId);
  } catch (error) {
    console.error("[события] не записал gist:", error);
  }
}

/**
 * Кладёт в базу таймаут сессии, с которым бот РЕАЛЬНО работает.
 *
 * Пульт сверяется именно с этой цифрой, а не с чужим .env: на сервере файла настроек
 * бота вообще нет — переменные приезжают из compose, и заглянуть в них пульту неоткуда.
 * Здесь же лежит факт, а не намерение, и соврать он не может.
 */
export function rememberSessionTimeout(minutes: number): void {
  const database = connect();
  if (!database) return;

  try {
    database
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('session_timeout_min', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(String(minutes));
  } catch (error) {
    console.error("[события] не записал таймаут сессии:", error);
  }
}
