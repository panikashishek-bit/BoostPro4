// Журнал обращений в Google-таблице «Клиенты».
//
// Колонки задаёт ВЛАДЕЛЕЦ в шапке таблицы, а не код: при старте читаем строку 1
// и раскладываем поля по её заголовкам. Переименовали колонку — правится таблица,
// а не исходники; колонок, которых в шапке нет, бот не создаёт и не придумывает.
//
// ⚠️ Сбой Google не должен ронять разговор. Всё, что здесь может упасть, гасится
// и уходит в лог: клиент не должен узнать, что у салона не пишется журнал.
// Тот же принцип, что в memory.ts: «разговор важнее журнала».

import { google, type sheets_v4 } from "googleapis";
import { config } from "./config.js";

/**
 * Поле бота → заголовок колонки в таблице.
 *
 * Это НЕ схема таблицы, а словарь для перевода: хозяин таблицы — шапка.
 * Если заголовка из правой колонки в таблице нет, поле просто не пишется.
 */
const COLUMNS = {
  id: "Обращение",
  startedAt: "Начало",
  endedAt: "Конец",
  chatId: "Чат",
  phone: "Телефон",
  channel: "Канал",
  intent: "Запрос",
  service: "Услуга",
  master: "Мастер",
  reached: "Дошёл до",
  outcome: "Итог",
  breakReason: "Почему сорвалось",
  bookingId: "ID записи",
  unanswered: "Вопрос без ответа",
  messages: "Сообщений",
  durationSec: "Секунд",
  name: "Имя",
} as const;

export type Field = keyof typeof COLUMNS;
export type Row = Partial<Record<Field, string | number>>;

/** Разложенная шапка: где какая колонка и сколько их всего. */
type Layout = { tab: string; index: Map<Field, number>; width: number };

let client: sheets_v4.Sheets | undefined;
let layout: Layout | undefined;

function sheets(): sheets_v4.Sheets {
  if (!client) {
    const auth = new google.auth.GoogleAuth({
      // Служебный аккаунт: боту не нужен вход в браузере, он программа и живёт на сервере.
      keyFile: config.googleSaKeyPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    client = google.sheets({ version: "v4", auth });
  }
  return client;
}

/** «A», «B», … «Z», «AA» — адрес колонки по её номеру с нуля. */
function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * Читает шапку таблицы один раз при старте.
 *
 * Вкладку не зашиваем: берём первую в таблице — её могли переименовать.
 * Возвращает false, если журнал недоступен; бот в этом случае работает как раньше,
 * просто без записи в таблицу.
 */
export async function connect(): Promise<boolean> {
  try {
    const meta = await sheets().spreadsheets.get({ spreadsheetId: config.sheetId });
    const tab = meta.data.sheets?.[0]?.properties?.title;
    if (!tab) throw new Error("в таблице нет ни одного листа");

    const head = await sheets().spreadsheets.values.get({
      spreadsheetId: config.sheetId,
      range: `${tab}!1:1`,
    });
    const headers = (head.data.values?.[0] ?? []).map((cell) => String(cell).trim());
    if (headers.length === 0) {
      console.error(
        `[журнал] в таблице «${meta.data.properties?.title}» пустая шапка — писать некуда. ` +
          "Впишите заголовки колонок в строку 1."
      );
      return false;
    }

    const index = new Map<Field, number>();
    for (const [field, title] of Object.entries(COLUMNS) as [Field, string][]) {
      const at = headers.findIndex((header) => header.toLowerCase() === title.toLowerCase());
      if (at !== -1) index.set(field, at);
    }

    layout = { tab, index, width: headers.length };

    const missing = (Object.entries(COLUMNS) as [Field, string][])
      .filter(([field]) => !index.has(field))
      .map(([, title]) => title);
    console.log(
      `[журнал] таблица «${meta.data.properties?.title}», лист «${tab}»: ` +
        `узнал ${index.size} из ${headers.length} колонок` +
        (missing.length ? `; не нашёл в шапке: ${missing.join(", ")}` : "")
    );
    return true;
  } catch (error) {
    console.error("[журнал] не удалось прочитать шапку таблицы:", describe(error));
    return false;
  }
}

/** Раскладывает поля по колонкам шапки. Ячейки чужих колонок остаются пустыми. */
function toCells(row: Row): string[] {
  const cells = new Array<string>(layout!.width).fill("");
  for (const [field, value] of Object.entries(row) as [Field, string | number][]) {
    const at = layout!.index.get(field);
    if (at !== undefined && value !== undefined && value !== null) cells[at] = String(value);
  }
  return cells;
}

function range(rowNumber?: number): string {
  const last = columnLetter(layout!.width - 1);
  return rowNumber ? `${layout!.tab}!A${rowNumber}:${last}${rowNumber}` : `${layout!.tab}!A:${last}`;
}

/**
 * Дописывает строку и возвращает её номер — по нему обращение потом дополняется.
 * null — записать не вышло; разговор от этого не страдает.
 */
export async function appendRow(row: Row): Promise<number | null> {
  if (!layout) return null;
  try {
    const result = await sheets().spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: range(),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [toCells(row)] },
    });
    // Ответ содержит диапазон вида «Sheet1!A2:Q2» — номер строки берём оттуда,
    // это надёжнее, чем считать строки самим.
    const updated = result.data.updates?.updatedRange ?? "";
    const rowNumber = Number(updated.match(/![A-Z]+(\d+)/)?.[1]);
    return Number.isFinite(rowNumber) ? rowNumber : null;
  } catch (error) {
    console.error("[журнал] не удалось добавить строку:", describe(error));
    return null;
  }
}

/**
 * Перезаписывает строку обращения.
 *
 * Перед записью сверяет ключ: владелец мог вставить или удалить строки руками,
 * и номер уехал бы. Не сошлось — ищем строку по ключу заново. Перезаписать
 * чужое обращение хуже, чем не записать своё.
 */
export async function updateRow(rowNumber: number, id: string, row: Row): Promise<number | null> {
  if (!layout) return null;
  const keyColumn = layout.index.get("id");

  try {
    let target = rowNumber;

    if (keyColumn !== undefined) {
      const letter = columnLetter(keyColumn);
      const cell = await sheets().spreadsheets.values.get({
        spreadsheetId: config.sheetId,
        range: `${layout.tab}!${letter}${rowNumber}`,
      });
      if (cell.data.values?.[0]?.[0] !== id) {
        const found = await findRowById(id, letter);
        if (!found) {
          console.warn(`[журнал] строка обращения ${id} не найдена, дописываю заново`);
          return appendRow(row);
        }
        target = found;
      }
    }

    await sheets().spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: range(target),
      valueInputOption: "RAW",
      requestBody: { values: [toCells(row)] },
    });
    return target;
  } catch (error) {
    console.error("[журнал] не удалось обновить строку:", describe(error));
    return null;
  }
}

/** Ищет строку обращения по ключу в колонке «Обращение». */
async function findRowById(id: string, letter: string): Promise<number | null> {
  const column = await sheets().spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${layout!.tab}!${letter}:${letter}`,
  });
  const at = (column.data.values ?? []).findIndex((cells) => cells[0] === id);
  return at === -1 ? null : at + 1;
}

/**
 * Короткое человеческое описание сбоя Google.
 * Полный ответ библиотеки — это простыня на пол-экрана, в логе от неё толку мало.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { code?: number })?.code;
  if (status === 403) {
    return `${message} — проверьте, что таблица расшарена на служебный аккаунт с правом редактирования`;
  }
  if (status === 404) return `${message} — проверьте SHEET_ID в .env`;
  return message;
}
