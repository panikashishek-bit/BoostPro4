import { bookingsByIds, bookingsCreatedIn, openBookingsDb, type BookingRow } from "../bookings-db";
import { demoFilter, type Demo } from "../demo";
import { openEventsDb } from "../events-db";
import { plural } from "../plural";
import { readClientsTable } from "../sheets";
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
    "Строка «не сверить»: один из источников не ответил, и подтвердить записи нечем. " +
      "Это НЕ значит, что клиенты потеряны — молчание Google или базы это молчание источника, " +
      "а не отсутствие записи. Пока источник не отвечает, счётчик честно говорит «не сверить» " +
      "и никого в список не заносит.",
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

  // Диапазон без верхней границы: Google отдаёт только заполненные строки,
  // а зашитый потолок однажды молча обрезал бы журнал на самом интересном.
  const table = await readClientsTable(env, "A:R");
  if ("problem" in table) return { ...empty, problem: table.problem };

  // Нет колонки — сверять НЕЧЕМ, и это беда журнала, а не клиентов. Скажи мы
  // «ID записи не проставлен» по каждой строке, владелец получил бы сотню
  // ложных тревог вместо одной честной строки «журнал к сверке не готов».
  const missing = [COLUMN.session, COLUMN.outcome, COLUMN.bookingId, COLUMN.createdAt].filter(
    (name) => table.at(name) === -1
  );
  if (missing.length > 0) {
    return {
      ...empty,
      problem: `в шапке нет ${missing.map((name) => `«${name}»`).join(", ")} — сверять нечем`,
    };
  }

  const session = table.at(COLUMN.session);
  const rows = new Map<string, JournalRow>();
  let booked = 0;

  for (const cells of table.rows) {
    const id = String(cells[session] ?? "").trim();
    if (!id) continue;

    const row: JournalRow = {
      outcome: String(cells[table.at(COLUMN.outcome)] ?? "").trim(),
      bookingId: String(cells[table.at(COLUMN.bookingId)] ?? "").trim(),
      // Колонки «Демо» может не быть вовсе — тогда учебных строк в таблице нет.
      demo: String(cells[table.at(COLUMN.demo)] ?? "").trim().toLowerCase() === "да",
      createdAt: String(cells[table.at(COLUMN.createdAt)] ?? "").trim(),
    };
    if (!demo.show && row.demo) continue;

    rows.set(id, row);
    // «Начало» записано как «ГГГГ-ММ-ДД ЧЧ:ММ:СС» — в этом виде дата
    // сравнивается как обычный текст, разбирать её не нужно.
    if (row.outcome === BOOKED && row.createdAt >= period.since) booked += 1;
  }

  return { rows, booked };
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

  // Проверяем ровно те записи, которые бот назвал своими. Лишнего не тянем.
  const ids = successes.map((success) => bookingIdOf(success, journal)).filter(Boolean);

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

/**
 * Какую запись бот назвал своей: сначала ID из лога, если он там есть, иначе —
 * из строки журнала.
 *
 * Одной функцией, а не двумя копиями правила: по нему и запрашиваются записи
 * из базы, и раскладываются случаи. Разъедься копии — счётчик запрашивал бы
 * одни записи, а судил о других, и заметить это было бы нечем.
 */
function bookingIdOf(success: Success, journal: Journal): string {
  return success.bookingId ?? journal.rows.get(success.sessionId)?.bookingId ?? "";
}

// --- Сборка ответа ---

/**
 * Что удалось выяснить про одно обращение.
 *
 * checked — сумели ли мы вообще проверить: недоступный источник это НЕ потерянная
 * запись, и объявлять клиента потерянным из-за молчания Google было бы худшим,
 * что может сделать этот счётчик. Один такой случай — и списку перестанут верить.
 */
type Verdict = { checked: boolean; confirmed: boolean; entry: CounterCase | null };

/** Раскладывает одно обращение по полочкам. Ничего не считает и не форматирует. */
function classify(success: Success, journal: Journal, database: Database): Verdict {
  const unchecked: Verdict = { checked: false, confirmed: false, entry: null };

  // База молчит — существование записи подтвердить нечем ни для кого.
  if (database.problem) return unchecked;

  const row = journal.rows.get(success.sessionId);
  const bookingId = bookingIdOf(success, journal);

  // ID нет ни в логе (старая строка), ни в журнале, потому что журнал не прочитан.
  // Это тоже «не смогли проверить», а не «следов нет».
  if (!bookingId && journal.problem) return unchecked;

  const base = {
    id: success.sessionId,
    title: `чат ${success.chatId} · ${human(success.ts)}`,
    gist: success.gist || undefined,
    demo: success.demo || undefined,
  };

  const booking = bookingId ? database.found.get(bookingId) : undefined;

  if (booking) {
    const checked = { checked: true, confirmed: true };
    if (booking.status === "CANCELLED") {
      return { ...checked, entry: { ...base, tone: "quiet", detail: "запись создана, но потом отменена" } };
    }
    if (!row) {
      return {
        ...checked,
        entry: {
          ...base,
          tone: "quiet",
          detail: "запись в базе есть, а строки в журнале нет — клиент придёт, сломался журнал",
        },
      };
    }
    if (row.outcome !== BOOKED) {
      return {
        ...checked,
        entry: {
          ...base,
          tone: "quiet",
          detail: `запись в базе есть, а в журнале итог «${row.outcome || "пусто"}»`,
        },
      };
    }
    return { ...checked, entry: null };
  }

  const lost = { checked: true, confirmed: false };

  if (bookingId) {
    return {
      ...lost,
      entry: { ...base, tone: "alarm", detail: `бот назвал запись ${bookingId}, но такой записи в базе нет` },
    };
  }
  if (row?.outcome === BOOKED) {
    return {
      ...lost,
      entry: {
        ...base,
        tone: "alarm",
        detail: "в журнале «записался», но ID записи не проставлен — подтвердить нечем",
      },
    };
  }
  return {
    ...lost,
    entry: { ...base, tone: "alarm", detail: "следов нет: ни строки в журнале, ни записи в базе" },
  };
}

function build(successes: Success[], journal: Journal, database: Database, demo: Demo): CounterValue {
  const verdicts = successes.map((success) => classify(success, journal, database));

  const said = successes.length;
  const checked = verdicts.filter((verdict) => verdict.checked).length;
  const confirmed = verdicts.filter((verdict) => verdict.confirmed).length;
  // Сначала тревожные: список нужен, чтобы идти звонить, а не читать сверху вниз.
  const cases = verdicts
    .map((verdict) => verdict.entry)
    .filter((entry): entry is CounterCase => entry !== null)
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "alarm" ? -1 : 1));
  const lost = cases.filter((one) => one.tone === "alarm").length;

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
    value: value(said, checked, lost),
    caption: caption(said, checked, confirmed, lost),
    figures,
    notes: signals(journal, database, said, checked, demo),
    cases,
  };
}

/**
 * Крупная строка на карточке.
 *
 * «Не сверить» — отдельное состояние, а не «сходится». Счётчик, который при
 * недоступном источнике показывает зелёное «сходится», врёт ровно в тот момент,
 * когда на него смотрят.
 */
function value(said: number, checked: number, lost: number): string {
  if (said === 0) return "—";
  if (lost > 0) return `${lost} ${plural(lost, "потерян", "потеряны", "потеряны")}`;
  if (checked < said) return "не сверить";
  return "сходится";
}

function caption(said: number, checked: number, confirmed: number, lost: number): string {
  if (said === 0) return "бот не подтверждал записей за этот период";
  if (lost > 0) {
    return (
      `Бот подтвердил ${said} ${plural(said, "запись", "записи", "записей")}, реально есть ${confirmed}. ` +
      `Разница — ${lost} ${plural(lost, "человек думает", "человека думают", "человек думают")}, ` +
      "что записаны, а их нет"
    );
  }
  if (checked < said) {
    return `проверить удалось ${checked} из ${said} — источник не отвечает, и молчание источника это не потеря записи`;
  }
  return `все ${said} ${plural(said, "запись на месте", "записи на месте", "записей на месте")}`;
}

function signals(
  journal: Journal,
  database: Database,
  said: number,
  checked: number,
  demo: Demo
): CounterNote[] {
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

  if (said > 0 && checked < said && !journal.problem && !database.problem) {
    notes.push({
      tone: "quiet",
      text: `проверить удалось ${checked} из ${said} обращений`,
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
