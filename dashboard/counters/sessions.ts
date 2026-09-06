import type { DatabaseSync } from "node:sqlite";
import { openEventsDb } from "../events-db";
import { lastDayBoundary } from "../period";
import { plural } from "../plural";
import type { Counter, CounterDay, CounterNote } from "./types";

// «Обращения» — первый счётчик пульта.
//
// Считаем ОБРАЩЕНИЯ, а не сообщения: одно обращение — это один разговор,
// сколько бы реплик в нём ни было. Иначе болтливый клиент выглядел бы как поток
// новых людей. Единица счёта — session_id, тот же, по которому бот пишет
// строку в таблицу «Клиенты».

/** Ниже этого числа выводы делать не на чем — и лучше сказать это вслух. */
const ENOUGH_DATA = 5;

export const sessionsCounter: Counter = {
  id: "sessions",
  title: "Обращения",

  info: [
    "Откуда данные: SQLite-лог, который ведёт бот-администратор (файл events.db). " +
      "Пульт открывает его только на чтение и пересчитывает всё заново на каждый F5 — кэша нет.",
    "Как считается: крупная цифра — сколько было ОБРАЩЕНИЙ, то есть разговоров, " +
      "а не сообщений. Один клиент, написавший десять реплик подряд, — это одно обращение. " +
      "Разговор считается законченным после 30 минут молчания (настройка SESSION_TIMEOUT_MIN); " +
      "напишет позже — начнётся новое обращение.",
    "Строка под цифрой — сколько за тот же период было РАЗНЫХ людей. Один человек мог " +
      "обратиться несколько раз, поэтому людей всегда не больше, чем обращений.",
    "График: по одному столбику на день. Дни, когда никто не написал, показаны нулём, " +
      "а не пропущены — иначе провал выглядел бы как ровный ряд и график врал бы.",
    "Если сложить столбики, может получиться больше крупной цифры — это не ошибка. "  +
      "Разговор, начатый до полуночи и продолженный после, виден в обоих днях, но обращение " +
      "при этом одно.",
    "Сигнал «Сутки тишины»: за последние 24 часа не было ни одного обращения, а раньше они " +
      "были. Чаще всего это значит, что бот упал или отвалился от Telegram, а не что клиенты " +
      "кончились. Проверять стоит бота, а не рекламу.",
    `Оговорка «данных пока мало»: пока обращений меньше ${ENOUGH_DATA}, любые выводы — ` +
      "это выводы на трёх точках. Цифра показана, но доверять её форме рано.",
  ],

  async collect({ env, period }) {
    const opened = openEventsDb(env);
    // Базы нет — пусть карточка скажет «нет данных» с этой причиной. Реестр ловит.
    if (!opened.ok) throw new Error(opened.problem);

    try {
      const totals = opened.db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT chat_id) AS people
           FROM events WHERE ts >= ?`
        )
        .get(period.since) as { sessions?: number; people?: number } | undefined;

      const sessions = Number(totals?.sessions ?? 0);
      const people = Number(totals?.people ?? 0);

      // По дням. substr(ts,1,10) — это «ГГГГ-ММ-ДД»: ts записан так, что дата
      // вырезается срезом строки, без разбора дат средствами SQLite.
      const byDay = opened.db
        .prepare(
          `SELECT substr(ts, 1, 10) AS day, COUNT(DISTINCT session_id) AS n
           FROM events WHERE ts >= ? GROUP BY day`
        )
        .all(period.since) as { day: string; n: number }[];

      const counts = new Map(byDay.map((row) => [row.day, Number(row.n)]));
      // Идём по ВСЕМ дням периода, а не по найденным в базе: пустые дни обязаны
      // попасть в график нулями.
      const days: CounterDay[] = period.dates.map((date) => ({
        date,
        count: counts.get(date) ?? 0,
      }));

      return {
        value: String(sessions),
        caption: `${people} ${plural(people, "человек", "человека", "человек")}`,
        chart: { title: `Обращения по дням, ${period.label}`, days },
        notes: signals(opened.db, sessions),
      };
    } finally {
      opened.db.close();
    }
  },
};

/**
 * Сигналы к действию.
 *
 * Тишина проверяется НЕ за выбранный период, а за последние сутки: это вопрос
 * «жив ли бот прямо сейчас», и он не должен зависеть от того, какую кнопку
 * наверху нажали.
 */
function signals(db: DatabaseSync, sessions: number): CounterNote[] {
  const notes: CounterNote[] = [];
  const boundary = lastDayBoundary();

  const recent = Number(
    (db.prepare("SELECT COUNT(*) AS n FROM events WHERE ts >= ?").get(boundary) as { n: number }).n
  );
  const earlier = Number(
    (db.prepare("SELECT COUNT(*) AS n FROM events WHERE ts < ?").get(boundary) as { n: number }).n
  );

  if (recent === 0 && earlier > 0) {
    notes.push({ tone: "alarm", text: "Сутки тишины — проверь, что бот жив" });
  }

  if (sessions < ENOUGH_DATA) {
    notes.push({ tone: "quiet", text: "данных пока мало, копятся" });
  }

  return notes;
}
