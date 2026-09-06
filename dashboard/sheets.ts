import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DashboardEnv } from "./config";

// Чтение Google-таблицы пультом — без библиотеки googleapis.
//
// Зависимости сознательно ноль. Во-первых, папку dashboard/ должно быть можно
// унести в другой проект целиком, а тянуть за ней npm-пакет — уже не «целиком».
// Во-вторых, у приложения googleapis в зависимостях нет, а образ собирается
// на боксе с 2 ГБ памяти, где каждая лишняя сборка — риск уйти в OOM.
//
// Взамен — то, что служебный аккаунт и так делает под капотом: подписываем JWT
// приватным ключом из файла ключа, меняем его на access-токен и ходим в REST API.
//
// Права запрашиваем ТОЛЬКО на чтение (spreadsheets.readonly): пульт показывает,
// а не правит. Даже ошибка в коде не сможет испортить таблицу владельца.

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccount = { client_email: string; private_key: string };

export type SheetKey = { account: ServiceAccount } | { problem: string };

/**
 * Ключ служебного аккаунта — файлом или переменной, как у бота.
 *
 * Локально удобнее файлом (CLIENTS_SA_KEY_PATH), в контейнере — переменной
 * (CLIENTS_SA_KEY) с тем же JSON в одну строку: пробрасывать файл внутрь
 * на этом хосте оказалось ненадёжно.
 */
export function readSheetKey(env: DashboardEnv): SheetKey {
  const inline = env.get("CLIENTS_SA_KEY");
  const path = env.get("CLIENTS_SA_KEY_PATH");

  if (!inline && !path) {
    return { problem: "ключ доступа не задан: нужен CLIENTS_SA_KEY_PATH (файл) или CLIENTS_SA_KEY (JSON строкой)" };
  }

  try {
    const raw = inline || readFileSync(resolve(process.cwd(), path), "utf8");
    const account = JSON.parse(raw) as ServiceAccount;
    if (!account.client_email || !account.private_key) {
      return { problem: "в ключе нет client_email или private_key — это не ключ служебного аккаунта" };
    }
    return { account };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { problem: `файла ключа нет по пути ${resolve(process.cwd(), path)}` };
    return { problem: `ключ не читается: ${(error as Error)?.message ?? code}` };
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Access-токен по ключу служебного аккаунта.
 *
 * Токен живёт час, поэтому он единственное, что здесь кэшируется. Это не кэш
 * ДАННЫХ: строки таблицы читаются заново на каждый запрос страницы. Кэшировать
 * токен нужно, чтобы F5 не превращался в лишний поход к Google каждые пять секунд.
 */
let token: { value: string; expiresAt: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
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
    // Next по умолчанию кэширует fetch — здесь это дало бы протухший токен.
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Google не выдал токен (${response.status}). Проверь, что ключ живой.`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

/** Значения диапазона. Пустые хвосты Google не присылает — строки бывают разной длины. */
export async function readRange(
  account: ServiceAccount,
  sheetId: string,
  range: string
): Promise<string[][]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
    `/values/${encodeURIComponent(range)}`;

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${await accessToken(account)}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 403) {
    throw new Error("нет доступа к таблице — поделись ею со служебным аккаунтом");
  }
  if (response.status === 404) {
    throw new Error("таблица не найдена — проверь CLIENTS_SHEET_ID");
  }
  if (!response.ok) {
    throw new Error(`Google ответил ${response.status}`);
  }

  const body = (await response.json()) as { values?: string[][] };
  return body.values ?? [];
}

/** Имя переменной с id таблицы клиентов. Одно на всех, кто её читает. */
export const CLIENTS_SHEET_VARIABLE = "CLIENTS_SHEET_ID";

export type SheetTable = {
  /** Шапка как есть, слева направо. */
  headers: string[];
  /** Строки без шапки; полностью пустые отброшены. */
  rows: string[][];
  /** Номер колонки по заголовку. -1 — такой колонки в шапке нет. */
  at(header: string): number;
};

/**
 * Открыть таблицу клиентов и разобрать шапку — один шаг на всех потребителей.
 *
 * Раньше это делали по копии «проверка связи» и счётчик сверки: одна и та же
 * последовательность (взять id, взять ключ, сходить, проверить пустоту, срезать
 * шапку) и одни и те же тексты ошибок, написанные дважды. Счётчики в этом проекте
 * нарочно не делят код между собой, но здесь дублировались не счётчики,
 * а ПРОЦЕДУРА ДОСТУПА к чужому сервису — а она обязана быть одна.
 *
 * Не бросает: возвращает problem человеческим языком, потому что и строка
 * «проверки связи», и карточка счётчика обязаны уметь сказать «не прочитал»
 * вместо пятисотой.
 */
export async function readClientsTable(
  env: DashboardEnv,
  range: string
): Promise<SheetTable | { problem: string }> {
  const sheetId = env.get(CLIENTS_SHEET_VARIABLE);
  if (!sheetId) return { problem: `переменная ${CLIENTS_SHEET_VARIABLE} не задана в dashboard/.env` };

  const key = readSheetKey(env);
  if ("problem" in key) return { problem: key.problem };

  try {
    const values = await readRange(key.account, sheetId, range);
    if (values.length === 0) return { problem: "таблица открылась, но она пустая — нет даже шапки" };

    const headers = values[0].map((cell) => String(cell).trim());
    const rows = values.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ""));

    return { headers, rows, at: (header) => headers.indexOf(header) };
  } catch (error) {
    return { problem: (error as Error)?.message ?? "таблица не читается" };
  }
}
