// Выгрузка журнала обращений из таблицы «Клиенты» в Markdown.
// Запуск: npm run export:clients (из папки bot_administrator).
//
// Кладёт project/clients-export.md — таблицу целиком, как она есть на момент запуска.
// Повторный запуск просто перезаписывает файл, поэтому выгрузка всегда свежая
// и её не надо чинить руками.
//
// ⚠️ В выгрузке имена и телефоны клиентов, а репозиторий публичный — файл закрыт
// в .gitignore и в git не едет. Тот же принцип, что у data/history.json.
//
// Только чтение: скоуп readonly, в таблицу скрипт не пишет ничего. Ошибиться
// и затереть журнал владельца он не может физически.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { google } from "googleapis";
import { config } from "./config.js";

/** Файл кладём в корень project/ — на уровень выше папки бота. */
const OUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../..", "clients-export.md");

/** Имя листа в адресе диапазона: пробелы в названии Google понимает только в кавычках. */
function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/** Ячейка в Markdown: вертикальная черта и перенос строки ломают разметку таблицы. */
function cell(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.replace(/\|/g, "\|").replace(/\r?\n/g, "<br>");
}

/** Markdown-таблица по шапке и строкам. Короткие строки добиваются пустыми ячейками. */
function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${headers.map((_, at) => cell(cells[at])).join(" | ")} |`;
  return [
    line(headers),
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/**
 * Короткое человеческое описание сбоя Google — как в sheet.ts.
 * Полный ответ библиотеки занимает пол-экрана и толку в нём мало.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { code?: number })?.code;
  if (status === 403) return `${message} — проверьте, что таблица расшарена на служебный аккаунт`;
  if (status === 404) return `${message} — проверьте SHEET_ID в bot_administrator/.env`;
  return message;
}

async function main(): Promise<void> {
  const spreadsheetId = config.sheetId;
  if (!spreadsheetId || (!config.googleSaKey && !config.googleSaKeyPath)) {
    throw new Error(
      "Выгрузка не настроена: нужны SHEET_ID и ключ служебного аккаунта " +
        "(GOOGLE_SA_KEY с JSON или GOOGLE_SA_KEY_PATH с путём к файлу) в bot_administrator/.env."
    );
  }

  const auth = new google.auth.GoogleAuth({
    ...(config.googleSaKey
      ? { credentials: JSON.parse(config.googleSaKey) as Record<string, string> }
      : { keyFile: config.googleSaKeyPath }),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // Вкладку не зашиваем: берём первую в таблице — её могли переименовать.
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const title = meta.data.properties?.title ?? "без названия";
  const tab = meta.data.sheets?.[0]?.properties?.title;
  if (!tab) throw new Error(`В таблице «${title}» нет ни одного листа.`);

  // Диапазон — весь лист: сколько в нём колонок и строк, решает владелец, а не код.
  const values = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: quoteTab(tab),
  });

  const [headers = [], ...rest] = (values.data.values ?? []) as string[][];
  if (headers.length === 0) {
    throw new Error(`В таблице «${title}» пустая шапка — выгружать нечего.`);
  }
  // Пустые строки в конце листа Google иногда отдаёт как пустые массивы.
  const rows = rest.filter((row) => row.some((value) => String(value ?? "").trim() !== ""));

  const stamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const link = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  const doc = [
    "# Журнал обращений — выгрузка",
    "",
    `Источник: [«${title}», лист «${tab}»](${link})`,
    "",
    `Выгружено: ${stamp} (МСК) · строк: ${rows.length}`,
    "",
    "⚠️ В файле имена и телефоны клиентов — он закрыт в `.gitignore` и в репозиторий не едет.",
    "Собрать заново: `npm run export:clients` в `bot_administrator/`.",
    "",
    table(headers, rows),
    "",
  ].join("\n");

  await writeFile(OUT_FILE, doc, "utf8");
  console.log(`Готово: ${OUT_FILE}`);
  console.log(`Таблица «${title}», лист «${tab}»: ${rows.length} строк, ${headers.length} колонок.`);
}

try {
  await main();
} catch (error) {
  console.error("[выгрузка]", describe(error));
  process.exit(1);
}
