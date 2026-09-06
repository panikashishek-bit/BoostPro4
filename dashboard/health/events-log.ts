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
        .prepare(
          `SELECT COUNT(*) AS total, MAX(ts) AS last,
                  COUNT(CASE WHEN is_demo <> '' THEN 1 END) AS demo
           FROM events`
        )
        .get() as { total?: number; last?: string | null; demo?: number } | undefined;

      const total = Number(stats?.total ?? 0);
      const last = stats?.last ?? null;
      const demo = Number(stats?.demo ?? 0);

      if (total === 0) {
        return {
          state: "ok",
          detail: `база найдена (${opened.path}), событий пока нет — напиши боту, и они появятся`,
        };
      }

      // Про учебные строки говорим прямо здесь же. «1116 событий» без оговорки —
      // ровно то враньё, от которого эта строка должна защищать.
      const drawn = demo > 0 ? `, из них ${demo} учебных (npm run demo:wipe сотрёт)` : "";

      return {
        state: "ok",
        detail: `база найдена: ${total} ${plural(total, "событие", "события", "событий")}${drawn}, последнее ${last}`,
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

