import { demoFilter, realBoundary } from "../demo";
import { openEventsDb } from "../events-db";
import { plural } from "../plural";
import type { Counter, CounterDay, CounterNote } from "./types";

// «Довели до записи» — воронка одним числом.
//
// Обращений много, но интересно не «сколько написали», а «сколько дошло».
// Один счётчик отвечает на один вопрос: из скольких разговоров получилась
// запись. Разница между этой цифрой и «Обращениями» и есть та работа, которую
// бот не доделал, — по ней и видно, чинить бота или звать рекламу.
//
// Единица счёта та же, что у соседа: session_id. Иначе две карточки считали бы
// разное под похожими словами, и сравнить их было бы нельзя.

/** Ниже этого числа доля в процентах — не показатель, а случайность. */
const ENOUGH_DATA = 10;

/** Порог, ниже которого воронку стоит идти чинить, а не наблюдать. */
const POOR = 0.5;

export const funnelCounter: Counter = {
  id: "funnel",
  title: "Довели до записи",

  info: [
    "Откуда данные: тот же SQLite-лог бота (events.db), что и у «Обращений». " +
      "Пульт читает его только на чтение и пересчитывает на каждый F5.",
    "Как считается: обращение считается доведённым, если внутри него есть событие " +
      "session_success — бот реально создал запись. Всё остальное — ушли: клиент " +
      "спросил и пропал, передумал на выборе времени или не дождался ответа.",
    "Крупная цифра — доля доведённых от всех обращений за период. Под ней те же " +
      "числа поштучно, потому что процент без знаменателя обманывает: «100%» на двух " +
      "обращениях и «74%» на двухстах — это разного веса утверждения.",
    "График: по одному столбику на день — сколько записей в этот день получилось. " +
      "Сравнивай его с графиком «Обращений»: одинаковая форма и разная высота значит, " +
      "что бот теряет всех одинаково, а провал только здесь — что он сломался на записи.",
    "Пунктирная черта — граница учебного и настоящего. Левее неё цифры дорисованы " +
      "командой npm run demo:seed и к твоему салону отношения не имеют.",
    `Сигнал «доходит меньше половины»: до записи добралось меньше ${Math.round(POOR * 100)}% ` +
      "обращений. Смотреть надо в колонку «Почему сорвалось» в таблице клиентов — " +
      "там написано, на чём именно люди уходят.",
    `Оговорка «данных пока мало»: пока обращений меньше ${ENOUGH_DATA}, доля скачет ` +
      "от одного человека, и читать её как процент рано.",
  ],

  async collect({ env, period, demo }) {
    const opened = openEventsDb(env);
    if (!opened.ok) throw new Error(opened.problem);

    try {
      const onlyReal = demoFilter(demo);

      // Одним запросом, а не двумя: два запроса к живой базе можно застать
      // в разных состояниях, и тогда доведённых окажется больше, чем всех.
      const totals = opened.db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS sessions,
                  COUNT(DISTINCT CASE WHEN event = 'session_success' THEN session_id END) AS won
           FROM events WHERE ts >= ?${onlyReal}`
        )
        .get(period.since) as { sessions?: number; won?: number } | undefined;

      const sessions = Number(totals?.sessions ?? 0);
      const won = Number(totals?.won ?? 0);
      const lost = sessions - won;

      const byDay = opened.db
        .prepare(
          `SELECT substr(ts, 1, 10) AS day, COUNT(DISTINCT session_id) AS n
           FROM events WHERE ts >= ? AND event = 'session_success'${onlyReal} GROUP BY day`
        )
        .all(period.since) as { day: string; n: number }[];

      const counts = new Map(byDay.map((row) => [row.day, Number(row.n)]));
      const days: CounterDay[] = period.dates.map((date) => ({
        date,
        count: counts.get(date) ?? 0,
      }));

      return {
        // Ноль обращений — это не «0%», а «не из чего считать». Прочерк честнее.
        value: sessions === 0 ? "—" : `${Math.round((won / sessions) * 100)}%`,
        caption:
          sessions === 0
            ? "обращений за период не было"
            : `${won} ${plural(won, "запись", "записи", "записей")} из ${sessions}, ` +
              `${lost} ${plural(lost, "ушёл", "ушли", "ушли")}`,
        chart: {
          title: `Записей по дням, ${period.label}`,
          days,
          realFrom: demo.show ? realBoundary(opened.db, period.since) : undefined,
        },
        notes: signals(sessions, won),
      };
    } finally {
      opened.db.close();
    }
  },
};

function signals(sessions: number, won: number): CounterNote[] {
  const notes: CounterNote[] = [];

  if (sessions >= ENOUGH_DATA && won / sessions < POOR) {
    notes.push({
      tone: "alarm",
      text: "Доходит меньше половины — смотри «Почему сорвалось» в таблице клиентов",
    });
  }

  if (sessions > 0 && sessions < ENOUGH_DATA) {
    notes.push({ tone: "quiet", text: "данных пока мало, доля скачет от одного человека" });
  }

  return notes;
}
