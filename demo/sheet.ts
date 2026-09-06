import { createSign } from "node:crypto";
import type { Access } from "./settings";

// Работа с Google-таблицей без библиотеки googleapis.
//
// Почему не googleapis: он лежит в зависимостях БОТА
// (bot_administrator/node_modules), а эти команды запускаются из корня проекта,
// где его нет. Тащить googleapis в приложение ради двух служебных команд —
// плохой размен; проще подписать JWT самим.
//
// ⚠️ Подпись JWT здесь — ВТОРАЯ копия того, что уже написано в dashboard/sheets.ts,
// и это осознанная плата, а не недосмотр. Общая функция означала бы импорт
// demo → dashboard, а у папки пульта есть ровно одно свойство, которое она
// у себя защищает: её можно скопировать в другой проект целиком. Сделай мы её
// зависимостью служебных команд — и вынести пульт стало бы нельзя, не сломав их.
// Сорок строк криптографии дешевле этой связи. Разница между копиями ровно одна:
// здесь scope на запись, там на чтение; править надо оба файла или ни одного.

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(account: Access["serviceAccount"]): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(account.private_key));

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Google не выдал токен (${response.status}). Проверь, что ключ живой.`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function call<T>(access: Access, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}/${encodeURIComponent(access.sheetId)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await accessToken(access.serviceAccount)}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 403) {
    throw new Error(
      "нет доступа к таблице — она должна быть расшарена на служебный аккаунт с правом РЕДАКТИРОВАНИЯ"
    );
  }
  if (response.status === 404) throw new Error("таблица не найдена — проверь SHEET_ID");
  if (!response.ok) throw new Error(`Google ответил ${response.status}: ${await response.text()}`);

  return (await response.json()) as T;
}

/** «A», «B», … «Z», «AA» — адрес колонки по номеру с нуля. */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

export type Layout = {
  /** Название первого листа. Вкладку не зашиваем — её могли переименовать. */
  tab: string;
  /** Внутренний номер листа. Нужен только удалению строк. */
  tabId: number;
  /** Шапка как есть, слева направо. */
  headers: string[];
};

/** Читает первый лист и его шапку — ровно так же, как это делает бот при старте. */
export async function readLayout(access: Access): Promise<Layout> {
  const meta = await call<{
    sheets?: { properties?: { title?: string; sheetId?: number } }[];
  }>(access, "?fields=sheets.properties");

  const properties = meta.sheets?.[0]?.properties;
  if (!properties?.title || properties.sheetId === undefined) {
    throw new Error("в таблице нет ни одного листа");
  }

  const head = await call<{ values?: string[][] }>(
    access,
    `/values/${encodeURIComponent(`${properties.title}!1:1`)}`
  );
  const headers = head.values?.[0]?.map((cell) => String(cell).trim()) ?? [];
  if (headers.length === 0) {
    throw new Error("в таблице пустая шапка — писать некуда");
  }

  return { tab: properties.title, tabId: properties.sheetId, headers };
}

/** Значения диапазона. Google не присылает пустые хвосты — строки бывают разной длины. */
export async function readRange(access: Access, range: string): Promise<string[][]> {
  const body = await call<{ values?: string[][] }>(
    access,
    `/values/${encodeURIComponent(range)}`
  );
  return body.values ?? [];
}

/** Вписывает одну ячейку — этим заводится заголовок колонки «Демо». */
export async function writeCell(access: Access, range: string, value: string): Promise<void> {
  await call(access, `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [[value]] }),
  });
}

/**
 * Дописывает строки В КОНЕЦ листа. Настоящие строки при этом не двигаются,
 * не перезаписываются и вообще не участвуют — append только добавляет.
 */
export async function appendRows(access: Access, range: string, rows: string[][]): Promise<number> {
  const body = await call<{ updates?: { updatedRows?: number } }>(
    access,
    `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) }
  );
  return body.updates?.updatedRows ?? 0;
}

/**
 * Удаляет строки по их номерам (1-based, как в самой таблице).
 *
 * Порядок здесь — вопрос корректности, а не аккуратности: Google применяет
 * запросы ПО ОЧЕРЕДИ, и после удаления пятой строки шестая становится пятой.
 * Поэтому идём сверху вниз, от больших номеров к меньшим, — иначе удаление
 * съезжает и утаскивает соседей, то есть настоящие строки владельца.
 */
export async function deleteRows(access: Access, tabId: number, rowNumbers: number[]): Promise<void> {
  if (rowNumbers.length === 0) return;

  const requests = [...rowNumbers]
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId: tabId,
          dimension: "ROWS",
          // API считает строки с нуля и не включает верхнюю границу.
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  // Пачками: тысяча запросов одним вызовом Google не любит.
  for (let at = 0; at < requests.length; at += 200) {
    await call(access, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: requests.slice(at, at + 200) }),
    });
  }
}
