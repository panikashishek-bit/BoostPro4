import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// Настройки учебных данных: что считать демо, за какой период его рисовать
// и откуда брать доступы.
//
// Своего .env у этой папки нет и не будет. Демо пишет ровно туда же, куда пишет
// бот, и теми же ключами — заведи ей отдельные настройки, и первое же расхождение
// (другой SHEET_ID, другой путь к базе) молча раскидало бы учебные строки мимо
// настоящих. Поэтому обе команды запускаются так:
//
//   tsx --env-file=.env --env-file=bot_administrator/.env demo/seed.ts
//
// то есть с теми самыми файлами, которые уже настроены, — см. npm-скрипты
// demo:seed и demo:wipe.

// --- Метка. Три источника, три способа сказать «эта строка учебная» ---

/**
 * Лог событий: колонка is_demo. Она уже была в схеме бота и у всех настоящих
 * строк пуста — бот её не заполняет никогда.
 */
export const EVENT_MARK = "1";

/** Google-таблица: своя колонка, заголовок и значение по-русски — её читает человек. */
export const SHEET_MARK_COLUMN = "Демо";
export const SHEET_MARK_VALUE = "да";

// В базе приложения метка — поле Booking.isDemo (см. prisma/schema.prisma).

// --- Период ---

/**
 * Сколько дней истории дорисовать. Последний учебный день — ВЧЕРА.
 * Сегодня и дальше — только настоящие данные владельца, эта граница не двигается.
 */
export const DEMO_DAYS = 30;

/** Зерно случайности. Меняешь — получаешь другую историю; не меняешь — ту же. */
export const SEED = 20260906;

// --- Объём ---

/** Сколько обращений в день. Выходные заметно тише будней — так это выглядит вживую. */
export const LOAD = {
  weekdayMin: 6,
  weekdayMax: 9,
  saturdayMin: 4,
  saturdayMax: 5,
  sundayMin: 2,
  sundayMax: 3,
  /** Сколько дней-всплесков и во сколько раз они выше обычного будня. */
  spikeDays: 2,
  spikeFactor: 2,
};

/** Доля обращений, дошедших до записи. Остальные — ушли, и это главное в картинке. */
export const SUCCESS_RATE = 0.74;

/** Из НЕдошедших: какая часть уходила на вопросе (J1), остальные — на записи (J2). */
export const QUESTION_SHARE = 0.62;

/** Сколько вымышленных клиентов ходит по этой истории. Один человек может вернуться. */
export const CLIENTS = 150;

/**
 * Номера чатов учебных клиентов: 700000001, 700000002, …
 *
 * Диапазон выбран так, чтобы не пересечься ни с одним настоящим чатом в базе.
 * Совпади номер — и «разных людей» на пульте стало бы меньше, чем на самом деле.
 */
export const CHAT_ID_BASE = 700_000_000;

// --- Доступы ---

export type Access = {
  eventsDbPath: string;
  sheetId: string;
  serviceAccount: { client_email: string; private_key: string };
};

/**
 * Собирает доступы из уже загруженных .env. Бросает с человеческим текстом:
 * это команда для владельца, и по сообщению должно быть понятно, что дописать.
 */
export function readAccess(): Access {
  const eventsDbPath = process.env.EVENTS_DB_PATH;
  if (!eventsDbPath) {
    throw new Error("не задан EVENTS_DB_PATH — он живёт в bot_administrator/.env");
  }

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) {
    throw new Error("не задан SHEET_ID — он живёт в bot_administrator/.env");
  }

  return {
    // Путь к базе и бот, и пульт считают от КОРНЯ ПРОЕКТА. Считаем так же:
    // разойдись мы здесь, демо легло бы во вторую базу, которой никто не видит.
    eventsDbPath: resolve(process.cwd(), eventsDbPath),
    sheetId,
    serviceAccount: readServiceAccount(),
  };
}

/**
 * Ключ служебного аккаунта — тот же, которым в таблицу пишет бот.
 *
 * Пульт сюда не годится: его ключ запрашивает права ТОЛЬКО на чтение, а нам
 * нужно и дописать строки, и потом их удалить.
 */
function readServiceAccount(): Access["serviceAccount"] {
  const inline = process.env.GOOGLE_SA_KEY;
  const path = process.env.GOOGLE_SA_KEY_PATH;

  if (!inline && !path) {
    throw new Error(
      "нет ключа Google: нужен GOOGLE_SA_KEY_PATH (файл) или GOOGLE_SA_KEY (JSON строкой) " +
        "в bot_administrator/.env"
    );
  }

  // В .env бота путь записан от ЕГО папки («../.secrets/google-bot.json»),
  // а команда запускается из корня проекта. Считаем его так же, как бот, —
  // иначе ключ «пропадал» бы ровно при запуске отсюда.
  const full = inline ? null : isAbsolute(path!) ? path! : resolve(process.cwd(), "bot_administrator", path!);

  try {
    const raw = inline ?? readFileSync(full!, "utf8");
    const account = JSON.parse(raw) as Access["serviceAccount"];
    if (!account.client_email || !account.private_key) {
      throw new Error("в ключе нет client_email или private_key — это не ключ служебного аккаунта");
    }
    return account;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new Error(`файла ключа нет по пути ${full}`);
    // JSON.parse бросает SyntaxError с разговором про позицию символа. Владельцу
    // от него пользы нет: чинить он будет не позицию, а файл целиком.
    if (error instanceof SyntaxError) {
      throw new Error(
        `ключ ${full ?? "из переменной GOOGLE_SA_KEY"} — не JSON. ` +
          "Похоже, файл повреждён или скопирован не целиком; возьми его заново в консоли Google Cloud."
      );
    }
    throw error;
  }
}
