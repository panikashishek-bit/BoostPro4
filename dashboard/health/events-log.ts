import { openEventsDb } from "../events-db";
import type { HealthSource } from "./types";

// Лог событий бота. Единственный способ владельца убедиться, что запись работает:
// в файл базы он не полезет, поэтому строка обязана отвечать на три вопроса —
// нашлась ли база, сколько в ней событий и когда было последнее.
//
// Последнее событие важнее количества: тысяча событий и последнее позавчера
// означает, что бот замолчал, а по одному лишь счётчику это незаметно.

export const eventsLogSource: HealthSource = {
  id: "events-log",
  title: "лог событий",

  check(env) {
    const opened = openEventsDb(env);
    if (!opened.ok) {
      return { state: "missing", detail: opened.problem };
    }

    try {
      const stats = opened.db
        .prepare("SELECT COUNT(*) AS total, MAX(ts) AS last FROM events")
        .get() as { total?: number; last?: string | null } | undefined;

      const total = Number(stats?.total ?? 0);
      const last = stats?.last ?? null;

      if (total === 0) {
        return {
          state: "ok",
          detail: `база найдена (${opened.path}), событий пока нет — напиши боту, и они появятся`,
        };
      }

      return {
        state: "ok",
        detail: `база найдена: ${total} ${plural(total)}, последнее ${last}`,
      };
    } catch (error) {
      // Файл есть, но таблицы в нём нет — обычно это чужой .db или база, которую
      // бот ещё не создавал. Это не «не подключено», это «подключено и не читается».
      return {
        state: "broken",
        detail: `${opened.path} открылся, но события из него не читаются: ${(error as Error)?.message}`,
      };
    } finally {
      if (opened.ok) opened.db.close();
    }
  },
};

/** «1 событие», «2 события», «5 событий» — иначе строка выглядит машинно. */
function plural(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return "событий";
  switch (n % 10) {
    case 1:
      return "событие";
    case 2:
    case 3:
    case 4:
      return "события";
    default:
      return "событий";
  }
}
