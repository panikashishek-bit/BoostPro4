import { openEventsDb } from "../events-db";
import { plural } from "../plural";
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
        detail: `база найдена: ${total} ${plural(total, "событие", "события", "событий")}, последнее ${last}`,
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

