import { bookingsByIds, bookingsCreatedIn, openBookingsDb, type BookingRow } from "../bookings-db";
import { demoFilter, type Demo } from "../demo";
import { openEventsDb } from "../events-db";
import { plural } from "../plural";
import { readRange, readSheetKey } from "../sheets";
import type { Period } from "../period";
import type { DashboardEnv } from "../config";
import type { Counter, CounterCase, CounterFigure, CounterNote, CounterValue } from "./types";

// «Сверка» — единственный счётчик, который проверяет не количество, а ПРАВДУ.
//
// Одно событие «клиент записан» оставляет три следа: бот пишет его себе в лог,
// дописывает строку в Google-таблицу и создаёт запись в базе приложения.
// Пока все три на месте, счётчик молчит зелёным. Разошлись — значит бот сказал
// клиенту «записала вас», а записи нет, и человек придёт к закрытой двери.
// Такое не ловится ни одним счётчиком количества: там всё будет ровно.
//
// Сопоставляем ТОЧНО, а не по времени с допуском. У бота есть номер разговора
// (session.id): он придумывает его на первом сообщении клиента и кладёт и в лог,
// и в колонку «Обращение» таблицы. По нему строка находится однозначно. Дальше
// в строке лежит «ID записи», который выдало приложение, — по нему проверяется
// сама запись. Допуск по времени тут был бы шагом назад: он умеет ошибаться,
// а точный ключ — нет.

const SHEET_VARIABLE = "CLIENTS_SHEET_ID";

/** Колонки таблицы, которые нужны сверке. Остальные не читаем и не трогаем. */
const COLUMN = {
  session: "Обращение",
  createdAt: "Начало",
  outcome: "Итог",
  bookingId: "ID записи",
  demo: "Демо",
} as const;

const BOOKED = "записался";

/**
 * Как бот пишет ID записи в событие session_success.
 *
 * ⚠️ Формат — договор с ботом (bot_administrator/src/session.ts). Меняешь там —
 * правь здесь, иначе сверка молча перестанет находить записи и начнёт пугать.
 * Старые строки написаны без ID: у них просто «запись создана», и это не ошибка.
 */
const SUCCESS_DETAILS = /^запись создана:\s*(\S+)$/;

export const reconcileCounter: Counter = {
  id: "reconcile",
  title: "Сверка",

  info: [
    "Зачем этот счётчик: он проверяет, что бот не наврал клиенту. Все остальные " +
      "счётчики верят боту на слово — если он сказал «записала вас», они это и покажут. " +
      "Здесь мы идём и смотрим, есть ли запись на самом деле.",
    "Откуда данные: три источника сразу. Лог бота (сколько раз он сказал клиенту «записал»), " +
      "твоя Google-таблица «Клиенты» (сколько строк с итогом «записался») и база приложения " +
      "(сколько записей реально заведено). Все три — только на чтение.",
    "Как сопоставляю: НЕ по времени и не по телефону, а по номеру разговора. Бот придумывает " +
      "его, когда клиент пишет первое сообщение, и ставит один и тот же номер и в лог, и в колонку " +
      "«Обращение» таблицы — значит строка находится точно, а не примерно. В найденной строке " +
      "лежит «ID записи», который выдало приложение; по нему проверяю, что запись есть в базе. " +
      "Цепочка: бот сказал → журнал записал → запись существует. Рвётся любое звено — человек " +
      "попадает в список ниже.",
    "Три числа могут расходиться и БЕЗ беды — это нормально. В базе больше, потому что туда " +
      "попадают записи с сайта и всё, что бот сделал до того, как у него появился лог. Поэтому " +
      "тревога считается не по разнице чисел, а по каждому клиенту отдельно: сказал ли ему бот " +
      "«записала» и нашлась ли его запись.",
    "Сигнал «человек думает, что записан»: бот подтвердил запись, а её нет ни в журнале, ни " +
      "в базе — или есть ID, но записи по нему не существует. Это не статистика, это конкретные " +
      "люди: иди и звони каждому из списка.",
    "Оговорка «в журнал не попало»: запись в базе ЕСТЬ, а строки в таблице нет. Клиент придёт " +
      "вовремя, бежать никуда не надо — сломался журнал в Google, а не запись.",
    "Учебные строки в списке помечены. Они дорисованы командой npm run demo:seed, реальных " +
      "людей за ними нет, и тревожиться на них не надо.",
  ],

  async collect({ env, period, demo }) {
    const successes = readSuccesses(env, period, demo);
    const journal = await readJournal(env, period, demo);
    const database = await readDatabase(env, period, demo, successes, journal);

    return build(successes, journal, database, demo);
  },
};

// --- Источник 1: лог бота ---

type Success = {
  sessionId: string;
  chatId: string;
  ts: string;
  /** ID записи, если бот его записал. У старых строк его нет. */
  bookingId: string | null;
  gist: string;
  demo: boolean;
};

function readSuccesses(env: DashboardEnv, period: Period, demo: Demo): Success[] {
  const opened = openEventsDb(env);
  if (!opened.ok) throw new Error(opened.problem);

  try {
    const onlyReal = demoFilter(demo);

    const rows = opened.db
      .prepare(
        `SELECT ts, session_id, chat_id, details, is_demo
         FROM events WHERE event = 'session_success' AND ts >= ?${onlyReal}
         ORDER BY ts`
      )
      .all(period.since) as {
      ts: string;
      session_id: string;
      chat_id: string;
      details: string;
      is_demo: string;
    }[];

    // gist лежит в другой строке того же обращения — в session_start. Забираем
    // одним запросом: по нему владелец узнаёт разговор, не открывая переписку.
    const gists = new Map(
      (
        opened.db
          .prepare(
            `SELECT session_id, gist FROM events
             WHERE event = 'session_start' AND ts >= ? AND gist <> ''${onlyReal}`
          )
          .all(period.since) as { session_id: string; gist: string }[]
      ).map((row) => [row.session_id, row.gist])
    );

    return rows.map((row) => ({
      sessionId: row.session_id,
      chatId: row.chat_id,
      ts: row.ts,
      bookingId: SUCCESS_DETAILS.exec(row.details)?.[1] ?? null,
      gist: gists.get(row.session_id) ?? "",
      demo: row.is_demo !== "",
    }));
  } finally {
    opened.db.close();
  }
}

// --- Источник 2: Google-таблица ---

type JournalRow = { outcome: string; bookingId: string; demo: boolean; createdAt: string };
type Journal = { rows: Map<string, JournalRow>; booked: number; problem?: string };

async function readJournal(env: DashboardEnv, period: Period, demo: Demo): Promise<Journal> {
  const empty: Journal = { rows: new Map(), booked: 0 };

  const sheetId = env.get(SHEET_VARIABLE);
  if (!sheetId) return { ...empty, problem: `${SHEET_VARIABLE} не задан в dashboard/.env` };

  const key = readSheetKey(env);
  if ("problem" in key) return { ...empty, problem: key.problem };

  try {
    // Диапазон без верхней границы: Google отдаёт только заполненные строки,
    // а зашитый потолок однажды молча обрезал бы журнал на самом интересном.
    const values = await readRange(key.account, sheetId, "A:R");
    if (values.length === 0) return { ...empty, problem: "таблица пустая — нет даже шапки" };

    const headers = values[0].map((cell) => String(cell).trim());
    const at = (name: string) => headers.indexOf(name);
    const session = at(COLUMN.session);
    if (session === -1) {
      return { ...empty, problem: `в шапке нет колонки «${COLUMN.session}» — сверять не с чем` };
    }

    const rows = new Map<string, JournalRow>();
    let booked = 0;

    for (const cells of values.slice(1)) {
      const id = String(cells[session] ?? "").trim();
      if (!id) continue;

      const row: JournalRow = {
        outcome: String(cells[at(COLUMN.outcome)] ?? "").trim(),
        bookingId: String(cells[at(COLUMN.bookingId)] ?? "").trim(),
        demo: String(cells[at(COLUMN.demo)] ?? "").trim().toLowerCase() === "да",
        createdAt: String(cells[at(COLUMN.createdAt)] ?? "").trim(),
      };
      if (!demo.show && row.demo) continue;

      rows.set(id, row);
      // «Начало» записано как «ГГГГ-ММ-ДД ЧЧ:ММ:СС» — в этом виде дата
      // сравнивается как обычный текст, разбирать её не нужно.
      if (row.outcome === BOOKED && row.createdAt >= period.since) booked += 1;
    }

    return { rows, booked };
  } catch (error) {
    return { ...empty, problem: (error as Error)?.message ?? "таблица не читается" };
  }
}

// --- Источник 3: база записей приложения ---

type Database = { byBot: number; total: number; found: Map<string, BookingRow>; problem?: string };

async function readDatabase(
  env: DashboardEnv,
  period: Period,
  demo: Demo,
  successes: Success[],
  journal: Journal
): Promise<Database> {
  const empty: Database = { byBot: 0, total: 0, found: new Map() };

  const opened = openBookingsDb(env);
  if (!opened.ok) return { ...empty, problem: opened.problem };

  // Проверяем ровно те записи, которые бот назвал своими: сначала ID из лога,
  // если он там есть, иначе ID из строки журнала. Лишнего из базы не тянем.
  const ids = successes
    .map((success) => success.bookingId ?? journal.rows.get(success.sessionId)?.bookingId ?? "")
    .filter(Boolean);

  try {
    const since = new Date(`${period.dates[0]}T00:00:00`);
    const until = new Date(`${period.dates[period.dates.length - 1]}T00:00:00`);
    until.setDate(until.getDate() + 1);

    const [created, found] = await Promise.all([
      bookingsCreatedIn(opened.db, since, until),
      bookingsByIds(opened.db, ids),
    ]);

    // Учебное убирается ОДНИМ фильтром на входе. Отфильтруй мы только одну
    // из двух цифр — переключатель «показывать демо» начал бы врать в подписи.
    const rows = demo.show ? created : created.filter((row) => !row.isDemo);
    return { byBot: rows.filter((row) => row.byBot).length, total: rows.length, found };
  } catch (error) {
    return { ...empty, problem: (error as Error)?.message ?? "база записей не читается" };
  }
}

// --- Сборка ответа ---

function build(successes: Success[], journal: Journal, database: Database, demo: Demo): CounterValue {
  const cases: CounterCase[] = [];
  let confirmed = 0;

  for (const success of successes) {
    const row = journal.rows.get(success.sessionId);
    const bookingId = success.bookingId ?? row?.bookingId ?? "";
    const booking = bookingId ? database.found.get(bookingId) : undefined;
    const when = human(success.ts);
    const base = {
      id: success.sessionId,
      title: `чат ${success.chatId} · ${when}`,
      gist: success.gist || undefined,
      demo: success.demo || undefined,
    };

    // Базы нет — проверить нечем, и врать про «потеряны» мы не станем:
    // отсутствие данных это не отсутствие записи.
    if (database.problem && !row) continue;

    if (booking) {
      confirmed += 1;
      if (booking.status === "CANCELLED") {
        cases.push({ ...base, tone: "quiet", detail: "запись создана, но потом отменена" });
      } else if (!row) {
        cases.push({
          ...base,
          tone: "quiet",
          detail: "запись в базе есть, а строки в журнале нет — клиент придёт, сломался журнал",
        });
      } else if (row.outcome !== BOOKED) {
        cases.push({
          ...base,
          tone: "quiet",
          detail: `запись в базе есть, а в журнале итог «${row.outcome || "пусто"}»`,
        });
      }
      continue;
    }

    if (bookingId) {
      cases.push({
        ...base,
        tone: "alarm",
        detail: `бот назвал запись ${bookingId}, но такой записи в базе нет`,
      });
    } else if (row?.outcome === BOOKED) {
      cases.push({
        ...base,
        tone: "alarm",
        detail: "в журнале «записался», но ID записи не проставлен — подтвердить нечем",
      });
    } else {
      cases.push({
        ...base,
        tone: "alarm",
        detail: "следов нет: ни строки в журнале, ни записи в базе",
      });
    }
  }

  const lost = cases.filter((one) => one.tone === "alarm").length;
  const said = successes.length;

  const figures: CounterFigure[] = [
    { label: "бот доложил", value: String(said) },
    {
      label: "в журнале",
      value: journal.problem ? "—" : String(journal.booked),
      note: journal.problem,
    },
    {
      label: "в базе",
      value: database.problem ? "—" : String(database.byBot),
      note: database.problem ?? (database.total > database.byBot ? `всего записей ${database.total}` : undefined),
    },
  ];

  return {
    value: said === 0 ? "—" : lost > 0 ? `${lost} ${plural(lost, "потерян", "потеряны", "потеряны")}` : "сходится",
    caption:
      said === 0
        ? "бот не подтверждал записей за этот период"
        : lost > 0
          ? `Бот подтвердил ${said} ${plural(said, "запись", "записи", "записей")}, реально есть ${confirmed}. ` +
            `Разница — ${lost} ${plural(lost, "человек думает", "человека думают", "человек думают")}, что записаны, а их нет`
          : `все ${said} ${plural(said, "запись на месте", "записи на месте", "записей на месте")}`,
    figures,
    notes: signals(journal, database, said, demo),
    // Сначала тревожные: список нужен, чтобы идти звонить, а не читать сверху вниз.
    cases: [...cases].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "alarm" ? -1 : 1)),
  };
}

function signals(journal: Journal, database: Database, said: number, demo: Demo): CounterNote[] {
  const notes: CounterNote[] = [];

  if (journal.problem) {
    notes.push({ tone: "alarm", text: `журнал не прочитан: ${journal.problem}` });
  }
  if (database.problem) {
    notes.push({ tone: "alarm", text: `база записей не прочитана: ${database.problem}` });
  }

  // Записей больше, чем бот доложил, — это норма, а не беда: их делают с сайта
  // и делали до того, как у бота появился лог. Сказать об этом надо, чтобы
  // расхождение чисел не читалось как поломка.
  const extra = database.byBot - said;
  if (!database.problem && extra > 0) {
    notes.push({
      tone: "quiet",
      text: `в базе на ${extra} ${plural(extra, "запись", "записи", "записей")} больше, чем бот доложил — сделаны не через бота или до появления лога`,
    });
  }

  if (!demo.show) {
    notes.push({ tone: "quiet", text: "учебные строки скрыты — сверяется только настоящее" });
  }

  return notes;
}

/** «2026-09-06 13:24:22» → «6 сентября, 13:24». Это читает человек. */
function human(ts: string): string {
  const at = new Date(ts.replace(" ", "T"));
  if (Number.isNaN(at.getTime())) return ts;
  return `${at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}, ${at.toLocaleTimeString(
    "ru-RU",
    { hour: "2-digit", minute: "2-digit" }
  )}`;
}
