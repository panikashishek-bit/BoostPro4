import type { DatabaseSync } from "node:sqlite";
import { openEventsDb } from "./events-db";
import { DASHBOARD_PATH, type DashboardEnv } from "./config";
import type { Period, PeriodKey } from "./period";

// Учебные данные на пульте: показывать их или нет и где кончается выдумка.
//
// Учебные строки дорисовывает команда npm run demo:seed — по месяцу истории
// в лог событий, в таблицу и в базу приложения, чтобы пульт можно было увидеть
// на настоящем объёме, не дожидаясь, пока он накопится сам. Стирает их
// npm run demo:wipe. Пульт про эти команды ничего не знает: он знает только
// метку и то, что при виде метки нужно сказать правду вслух.
//
// Правил здесь два, и оба про честность:
//   • пока в цифрах есть учебные строки, пульт ОБЯЗАН написать об этом в шапке.
//     Незаметно красивый график — худшее, что может случиться с пультом;
//   • переключатель обязан уметь выключить их совсем, чтобы владелец в любой
//     момент мог посмотреть только на своё настоящее.

/** Метка учебной строки в логе событий. Та же, что ставит demo/settings.ts. */
const MARK = "1";

export type Demo = {
  /** Показывать учебные строки в цифрах. По умолчанию да — иначе их незачем рисовать. */
  show: boolean;
};

/** Разбирает ?demo= из адреса. Всё, кроме явного «off», — показывать. */
export function resolveDemo(raw: unknown): Demo {
  return { show: raw !== "off" };
}

/**
 * Довесок к WHERE для запросов к логу событий.
 *
 * Возвращает готовый кусок SQL, а не параметр: параметром сюда идут только
 * значения, а условие целиком — константа из этого файла. Снаружи в него
 * ничего не подставляется и подставиться не может.
 */
export function demoFilter(demo: Demo): string {
  return demo.show ? "" : ` AND is_demo <> '${MARK}'`;
}

/** Сколько учебного попало в выбранный период. null — лог недоступен, и это не наша беда. */
export function countDemo(
  env: DashboardEnv,
  period: Period
): { sessions: number; events: number } | null {
  const opened = openEventsDb(env);
  if (!opened.ok) return null;

  try {
    const row = opened.db
      .prepare(
        `SELECT COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS events
         FROM events WHERE ts >= ? AND is_demo = ?`
      )
      .get(period.since, MARK) as { sessions?: number; events?: number } | undefined;

    return { sessions: Number(row?.sessions ?? 0), events: Number(row?.events ?? 0) };
  } catch {
    // Старый лог без колонки is_demo — значит учебного в нём нет вовсе.
    return { sessions: 0, events: 0 };
  } finally {
    opened.db.close();
  }
}

/**
 * День, с которого в периоде начинаются НАСТОЯЩИЕ строки. undefined — учебных
 * в периоде нет, и отбивать нечего.
 *
 * Определение нарочно такое: не «завтра после последнего учебного дня», а
 * «первый день, где есть хоть одна ненарисованная строка». Так граница не
 * соврёт, даже если однажды учебное и настоящее перемешаются во времени, —
 * а команда дорисовки такого не допускает только сегодня.
 */
export function realBoundary(db: DatabaseSync, since: string): string | undefined {
  const row = db
    .prepare(
      `SELECT MIN(CASE WHEN is_demo <> ? THEN substr(ts, 1, 10) END) AS real_from,
              COUNT(CASE WHEN is_demo = ? THEN 1 END) AS demo
       FROM events WHERE ts >= ?`
    )
    .get(MARK, MARK, since) as { real_from?: string | null; demo?: number } | undefined;

  if (!row?.demo || !row.real_from) return undefined;
  return row.real_from;
}

/**
 * Адрес пульта с заданными переключателями.
 *
 * Оба переключателя — обычные ссылки, без клиентского кода: страница и так
 * собирается на сервере на каждый запрос. Поэтому каждая ссылка обязана нести
 * ОБА параметра — иначе переключение периода молча сбрасывало бы демо, и
 * владелец получал бы не тот экран, который выбрал.
 */
export function dashboardHref(period: PeriodKey, demo: Demo): string {
  return `${DASHBOARD_PATH}?period=${period}${demo.show ? "" : "&demo=off"}`;
}
