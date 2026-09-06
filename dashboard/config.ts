import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Настройки пульта: чтение СВОЕГО файла .env и ничего больше.
//
// Пульт принципиально не читает process.env и не трогает чужие .env
// (приложения, бота, менеджера). Причина простая: папку dashboard/ должно быть
// можно скопировать в другой проект целиком, и она обязана там завестись.
// Если бы пароль приезжал из окружения приложения, переезд молча ломался бы —
// страница открывалась бы, но пускала не тем паролем или не пускала вовсе.
//
// Обратная сторона того же правила: значения отсюда НИКОГДА не попадают
// в process.env. Иначе пульт незаметно подменял бы переменные приложению.

/**
 * Корень проекта. Next запускает сервер именно из него: локально это папка
 * project/, в контейнере — WORKDIR /app. Поэтому dashboard/.env лежит в обоих
 * случаях по одному и тому же относительному пути.
 *
 * Почему не import.meta.url, как в manager/: там код исполняется файлом as-is,
 * а здесь Next собирает его в .next/server/… . От собранного файла до исходной
 * папки dashboard/ пути нет — он указывал бы внутрь сборки.
 */
export const DASHBOARD_DIR = resolve(process.cwd(), "dashboard");

/** Единственный файл настроек, который пульт вообще открывает. */
export const ENV_PATH = resolve(DASHBOARD_DIR, ".env");

/** Пароль, с которым пульт приезжает из .env.example. Пока он такой — пульт ругается. */
export const DEFAULT_PASSWORD = "admin";

export type DashboardEnv = {
  /** Полный путь к файлу — его показываем человеку, когда файла нет. */
  path: string;
  /** Файл найден и прочитан. */
  found: boolean;
  /** Если не найден или не прочитался — человеческое объяснение, без стектрейса. */
  problem?: string;
  /** Значение переменной. Не задана, пустая строка и пробелы — одно и то же: "". */
  get(name: string): string;
};

/**
 * Разбирает содержимое .env в пары имя→значение.
 *
 * Свой разбор вместо process.loadEnvFile сознательно: тот пишет результат
 * в process.env на весь процесс, то есть пульт заодно менял бы окружение
 * приложения. Нам нужен обычный объект, живущий ровно один запрос.
 */
function parse(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Кавычки вокруг значения снимаем: их ставят по привычке из shell,
    // а частью пароля или пути они не являются.
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);

    if (name) values.set(name, value);
  }

  return values;
}

/**
 * Читает dashboard/.env заново. Вызывается на КАЖДЫЙ запрос и ничего не кэширует:
 * поправил файл, нажал F5 — увидел новое. Файл маленький, читать его дёшево.
 *
 * Не бросает никогда. Пульт должен уметь показать «файла нет» страницей,
 * а не пятисотой: именно так человек узнаёт, что .env не доехал на сервер.
 */
export function readDashboardEnv(): DashboardEnv {
  const empty = { path: ENV_PATH, get: () => "" };

  let text: string;
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch (error) {
    return { ...empty, found: false, problem: explain(error) };
  }

  const values = parse(text);
  return {
    path: ENV_PATH,
    found: true,
    get: (name) => values.get(name)?.trim() ?? "",
  };
}

/** Переводит ошибку чтения файла в объяснение, по которому понятно, что чинить. */
function explain(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;

  if (code === "ENOENT") {
    return "файла нет — он не едет деплоем, его кладут на сервер отдельно";
  }
  if (code === "EISDIR") {
    // Реальная ловушка: docker создаёт ПАПКУ на месте отсутствующего файла,
    // если тот смонтирован как том. Снаружи выглядит как «пульт сломался».
    return "по этому пути папка, а не файл — docker создал её вместо тома, файл нужно положить и перезапустить контейнер";
  }
  if (code === "EACCES") {
    return "нет прав на чтение файла";
  }
  return `файл не читается (${code ?? "неизвестная причина"})`;
}

/** Пароль на вход. Пустой — значит вход закрыт, и пульт скажет об этом прямо. */
export function dashboardPassword(env: DashboardEnv): string {
  return env.get("DASHBOARD_PASSWORD");
}

/**
 * Адрес, по которому пульт подключён к приложению.
 *
 * Живёт здесь, а не в коде приложения: точка подключения
 * (src/app/dashboard/page.tsx) — это три строки, которые ничего не решают,
 * а вот перерисовке страницы после входа нужно знать свой маршрут.
 * Меняешь адрес — правишь тут и там, больше нигде.
 */
export const DASHBOARD_PATH = "/dashboard";
