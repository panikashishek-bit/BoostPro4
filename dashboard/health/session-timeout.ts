import { openEventsDb, readMetaNumber } from "../events-db";
import { sessionTimeoutMin } from "../config";
import type { HealthSource } from "./types";

// Сверка таймаута сессии между ботом и пультом.
//
// Это единственная переменная, где дубль по-настоящему опасен: по ней бот РЕЖЕТ
// сессии, а пульт СЧИТАЕТ по ним брошенные обращения. Разъедутся — воронка начнёт
// врать правдоподобно: цифры на месте, они неверные, и заметить это неоткуда.
//
// Сверяемся с базой, а не с .env бота, сознательно. На сервере файла bot_administrator/.env
// не существует вовсе: бот в контейнере получает переменные через environment: из compose,
// а пульт живёт в другом контейнере и чужого окружения не видит. В базе же лежит
// значение, с которым бот работает НА САМОМ ДЕЛЕ, — соврать оно не может.

const BOT_KEY = "session_timeout_min";

export const sessionTimeoutSource: HealthSource = {
  id: "session-timeout",
  title: "таймаут сессии",

  check(env) {
    const mine = sessionTimeoutMin(env);

    const opened = openEventsDb(env);
    if (!opened.ok) {
      return {
        state: "missing",
        detail: `у меня ${mine} мин; с чем сверять — пока неизвестно, лог событий не подключён`,
      };
    }

    try {
      const theirs = readMetaNumber(opened.db, BOT_KEY);

      if (theirs === undefined) {
        return {
          state: "missing",
          detail:
            `у меня ${mine} мин; бот свою цифру в базу ещё не записал — ` +
            "сверить не с чем, пока он не запустится с новой версией",
        };
      }

      if (theirs !== mine) {
        return {
          state: "broken",
          detail: `у бота таймаут сессии ${theirs}, у меня ${mine} — цифры разошлись, воронке верить нельзя`,
        };
      }

      return { state: "ok", detail: `и у бота, и у меня ${mine} мин — сходится` };
    } catch (error) {
      return {
        state: "broken",
        detail: `не удалось сверить таймаут: ${(error as Error)?.message}`,
      };
    } finally {
      if (opened.ok) opened.db.close();
    }
  },
};
