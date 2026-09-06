import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { day, planDemo, stamp, verify, type CatalogueItem, type PlannedSession } from "./plan";
import { appendRows, columnLetter, readLayout, readRange, writeCell } from "./sheet";
import {
  DEMO_DAYS,
  EVENT_MARK,
  SHEET_MARK_COLUMN,
  SHEET_MARK_VALUE,
  readAccess,
  type Access,
} from "./settings";

// Дорисовать учебную историю: npm run demo:seed
//
// Пишет в три источника сразу — лог событий, базу приложения и Google-таблицу, —
// и в каждом ставит метку «это учебная строка». Настоящие строки владельца
// при этом не читаются на изменение, не двигаются и не перезаписываются:
// в лог и в базу мы только ВСТАВЛЯЕМ, в таблицу только ДОПИСЫВАЕМ в конец.
//
// Стереть всё это одним движением — npm run demo:wipe.

/** Шаг сетки записи. Тот же, что у приложения (src/lib/availability.ts). */
const SLOT_STEP_MIN = 30;

async function main(): Promise<void> {
  const access = readAccess();
  const prisma = new PrismaClient();
  const today = new Date();

  try {
    await refuseIfDemoExists(access, prisma);

    const catalogue = await readCatalogue(prisma);
    const sessions = planDemo(today, catalogue);
    verify(sessions, today);

    report(sessions, today);

    // «Посмотреть, что получится, ничего не записав»: npm run demo:seed -- --dry.
    // Проверять план по факту записи в три источника — дорогое удовольствие.
    if (process.argv.includes("--dry")) {
      console.log("");
      console.log("Это черновой прогон (--dry): не записано ничего.");
      preview(sessions);
      return;
    }

    // Записи заводим ПЕРВЫМИ: их идентификаторы уходят и в событие session_success,
    // и в колонку «ID записи». Бот делает так же — сначала создаёт запись,
    // потом докладывает о ней в лог.
    const bookings = await writeBookings(prisma, sessions, today);
    const events = writeEvents(access, sessions, bookings);
    const rows = await writeSheet(access, sessions, bookings);

    console.log("");
    console.log("Дорисовано:");
    console.log(`  лог событий      ${events} строк (is_demo = ${EVENT_MARK})`);
    console.log(`  база приложения  ${bookings.size} записей (isDemo = true)`);
    console.log(`  Google-таблица   ${rows} строк («${SHEET_MARK_COLUMN}» = «${SHEET_MARK_VALUE}»)`);
    console.log("");
    console.log("Стереть всё это целиком: npm run demo:wipe");
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Второй запуск подряд удвоил бы историю, и разобрать её потом было бы нечем.
 * Поэтому дорисовываем только на чистое: сначала сотри, потом рисуй заново.
 *
 * Спрашиваем ВСЕ ТРИ источника, а не два «понадёжнее». Стирание таблицы —
 * единственная сетевая операция из трёх, и упасть на середине может только она:
 * таймаут, квота, отвалившийся доступ. Проверяй мы лог и базу, такой обрыв
 * выглядел бы как «демо стёрто», следующий demo:seed прошёл бы молча и дописал
 * вторую сотню строк поверх первой. В таблице стало бы больше «записался», чем
 * session_success в логе, — то самое противоречие цифр, которого здесь быть
 * не должно.
 */
async function refuseIfDemoExists(access: Access, prisma: PrismaClient): Promise<void> {
  const db = new DatabaseSync(access.eventsDbPath);
  let inLog = 0;
  try {
    inLog = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM events WHERE is_demo = ?").get(EVENT_MARK) as { n: number }).n
    );
  } catch {
    // Базы или таблицы ещё нет — значит и демо в ней нет. Заведём при записи.
  } finally {
    db.close();
  }

  const inApp = await prisma.booking.count({ where: { isDemo: true } });
  const inSheet = await countDemoRows(access);

  if (inLog > 0 || inApp > 0 || inSheet > 0) {
    throw new Error(
      `учебные данные уже есть (в логе ${inLog}, в базе приложения ${inApp}, ` +
        `в таблице ${inSheet}). Сначала сотри их: npm run demo:wipe`
    );
  }
}

/** Сколько учебных строк лежит в таблице. Нет колонки «Демо» — значит ни одной. */
async function countDemoRows(access: Access): Promise<number> {
  const layout = await readLayout(access);
  const at = layout.headers.indexOf(SHEET_MARK_COLUMN);
  if (at === -1) return 0;

  const letter = columnLetter(at);
  const column = await readRange(access, `${layout.tab}!${letter}:${letter}`);
  // Первая строка — шапка, в счёт не идёт.
  return column
    .slice(1)
    .filter((row) => String(row[0] ?? "").trim().toLowerCase() === SHEET_MARK_VALUE).length;
}

/** Услуги и мастера — ТОЛЬКО из базы владельца. Своих мы не придумываем. */
async function readCatalogue(prisma: PrismaClient): Promise<CatalogueItem[]> {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    include: { masters: { include: { master: true } } },
    orderBy: { createdAt: "asc" },
  });

  return services
    .map((service) => ({
      service: service.name,
      masters: service.masters.filter((link) => link.master.isActive).map((link) => link.master.name),
    }))
    .filter((item) => item.masters.length > 0);
}

/** Что получилось — до того, как хоть одна строка ушла в источник. */
function report(sessions: PlannedSession[], today: Date): void {
  const succeeded = sessions.filter((session) => session.succeeded).length;
  const people = new Set(sessions.map((session) => session.chatId)).size;
  const events = sessions.reduce((sum, session) => sum + session.events.length, 0);
  const days = new Set(sessions.map((session) => day(session.startedAt)));

  console.log(`Учебная история: ${DEMO_DAYS} дней, последний — ${day(sessions[sessions.length - 1].startedAt)}`);
  console.log(`Сегодня (${day(today)}) не тронуто: демо кончается вчера.`);
  console.log("");
  console.log(`  обращений        ${sessions.length} за ${days.size} дней`);
  console.log(`  разных людей     ${people}`);
  console.log(
    `  дошли до записи  ${succeeded} (${Math.round((succeeded / sessions.length) * 100)}%), ` +
      `ушли ${sessions.length - succeeded}`
  );
  console.log(`  событий в логе   ${events}`);
}

/** Черновой прогон: по дням и пара обращений целиком — глазами. */
function preview(sessions: PlannedSession[]): void {
  const byDay = new Map<string, { total: number; won: number }>();
  for (const session of sessions) {
    const key = day(session.startedAt);
    const cell = byDay.get(key) ?? { total: 0, won: 0 };
    byDay.set(key, { total: cell.total + 1, won: cell.won + (session.succeeded ? 1 : 0) });
  }

  console.log("");
  console.log("По дням (обращений / из них дошли):");
  for (const [date, cell] of byDay) {
    console.log(`  ${date}  ${String(cell.total).padStart(2)} / ${cell.won}  ${"▇".repeat(cell.total)}`);
  }

  console.log("");
  console.log("Как выглядит обращение целиком:");
  for (const session of [sessions.find((s) => s.succeeded)!, sessions.find((s) => !s.succeeded)!]) {
    console.log(`  ${session.sessionId}  ${session.outcome}, ${session.reached}`);
    for (const event of session.events) {
      console.log(`    ${stamp(event.at)}  ${event.event.padEnd(15)} ${event.details} ${event.gist}`);
    }
  }
}

// --- Лог событий ---

/**
 * Пишет события. Метка is_demo = «1» стоит у КАЖДОЙ строки — это и есть
 * единственный признак, по которому демо потом находится и стирается.
 */
function writeEvents(
  access: Access,
  sessions: PlannedSession[],
  bookings: Map<string, string>
): number {
  const db = new DatabaseSync(access.eventsDbPath);

  try {
    // Схема — та же, что заводит бот. Если базы ещё нет, создаём её так же,
    // как это сделал бы он: иначе бот потом наткнётся на чужую таблицу.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT NOT NULL,
        session_id TEXT NOT NULL,
        chat_id    TEXT NOT NULL,
        event      TEXT NOT NULL,
        details    TEXT NOT NULL DEFAULT '',
        gist       TEXT NOT NULL DEFAULT '',
        is_demo    TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS events_ts_idx      ON events (ts);
      CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id);
    `);

    const insert = db.prepare(
      `INSERT INTO events (ts, session_id, chat_id, event, details, gist, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    let written = 0;
    db.exec("BEGIN");
    try {
      for (const session of sessions) {
        const bookingId = bookings.get(session.sessionId);
        for (const event of session.events) {
          // У session_success в details лежит ID созданной записи — ровно так же,
          // как это делает бот. Без него учебная строка отличалась бы от настоящей
          // по форме, а счётчик «Сверка» читает именно это поле.
          const details =
            event.event === "session_success" && bookingId
              ? `запись создана: ${bookingId}`
              : event.details;

          insert.run(
            stamp(event.at),
            session.sessionId,
            String(session.chatId),
            event.event,
            details,
            event.gist,
            EVENT_MARK
          );
          written += 1;
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return written;
  } finally {
    db.close();
  }
}

// --- Записи в базе приложения ---

type Slot = { masterId: string; serviceId: string; startAt: Date; endAt: Date };

/**
 * Заводит записи для тех обращений, что дошли до цели.
 *
 * Дата визита ПОЗЖЕ даты обращения — человек записывается заранее, а не задним
 * числом. При этом весь визит остаётся в прошлом: учебная запись не имеет права
 * занять живое окошко в календаре мастера. Ровно поэтому же демо не заходит
 * на сегодня — граница одна для всех трёх источников.
 */
async function writeBookings(
  prisma: PrismaClient,
  sessions: PlannedSession[],
  today: Date
): Promise<Map<string, string>> {
  const services = await prisma.service.findMany({ select: { id: true, name: true, durationMin: true } });
  const masters = await prisma.master.findMany({
    select: { id: true, name: true, workingHours: true },
  });

  const serviceByName = new Map(services.map((service) => [service.name, service]));
  const masterByName = new Map(masters.map((master) => [master.name, master]));

  // Занятость: сначала настоящие записи владельца, дальше по ходу дела — свои.
  const busy = (
    await prisma.booking.findMany({
      where: { status: { not: "CANCELLED" } },
      select: { masterId: true, startAt: true, endAt: true },
    })
  ).map((booking) => ({ ...booking }));

  const lastDemoDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  lastDemoDay.setDate(lastDemoDay.getDate() - 1);

  const created = new Map<string, string>();
  let sameDay = 0;

  for (const session of sessions) {
    if (!session.succeeded || !session.service || !session.master) continue;

    const service = serviceByName.get(session.service);
    const master = masterByName.get(session.master);
    if (!service || !master) continue;

    const slot = findSlot(session, service, master, busy, lastDemoDay);
    if (!slot) {
      throw new Error(
        `не нашлось свободного окна для обращения ${session.sessionId} ` +
          `(${session.service}, ${session.master}) — сузь объём или период`
      );
    }
    if (day(slot.startAt) === day(session.startedAt)) sameDay += 1;

    const booking = await prisma.booking.create({
      data: {
        masterId: slot.masterId,
        serviceId: slot.serviceId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        status: "CONFIRMED",
        clientName: session.name!,
        clientPhone: session.phone!,
        // Тот же комментарий, что бот ставит настоящим записям.
        comment: "Запись через Telegram-бота",
        createdAt: session.endedAt,
        isDemo: true,
      },
      select: { id: true },
    });

    busy.push({ masterId: slot.masterId, startAt: slot.startAt, endAt: slot.endAt });
    created.set(session.sessionId, booking.id);
  }

  if (sameDay > 0) {
    console.log(
      `  (у ${sameDay} обращений последнего дня визит попал на тот же день — ` +
        "позже по времени, но не позже по дате: учебной истории уже некуда расти вправо)"
    );
  }

  return created;
}

/**
 * Ищет свободное окно: сначала на следующих днях после обращения, и только для
 * самого последнего дня истории — на нём же, но строго после разговора.
 */
function findSlot(
  session: PlannedSession,
  service: { id: string; durationMin: number },
  master: { id: string; workingHours: { weekday: number; startMin: number; endMin: number }[] },
  busy: { masterId: string; startAt: Date; endAt: Date }[],
  lastDemoDay: Date
): Slot | null {
  const from = new Date(session.startedAt.getFullYear(), session.startedAt.getMonth(), session.startedAt.getDate());

  // Сначала — дни ПОСЛЕ обращения (не дальше десяти: дальше уже не «записался
  // заранее», а «непонятно когда»). Потом, если истории некуда расти, — тот же
  // день, но позже разговора.
  const candidates: { date: Date; after: Date | null }[] = [];
  for (let ahead = 1; ahead <= 10; ahead += 1) {
    const date = new Date(from);
    date.setDate(date.getDate() + ahead);
    if (date > lastDemoDay) break;
    candidates.push({ date, after: null });
  }
  candidates.push({ date: from, after: session.endedAt });

  for (const { date, after } of candidates) {
    const weekday = date.getDay() === 0 ? 7 : date.getDay();
    for (const hours of master.workingHours.filter((wh) => wh.weekday === weekday)) {
      for (let minute = hours.startMin; minute + service.durationMin <= hours.endMin; minute += SLOT_STEP_MIN) {
        const startAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minute, 0, 0);
        const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);

        if (after && startAt <= after) continue;
        const overlaps = busy.some(
          (booking) => booking.masterId === master.id && startAt < booking.endAt && endAt > booking.startAt
        );
        if (overlaps) continue;

        return { masterId: master.id, serviceId: service.id, startAt, endAt };
      }
    }
  }

  return null;
}

// --- Google-таблица ---

/** Поле обращения → заголовок колонки. Тот же словарь, что у бота (src/sheet.ts). */
const COLUMNS: Record<string, (session: PlannedSession, bookingId: string) => string> = {
  Обращение: (session) => session.sessionId,
  Начало: (session) => stamp(session.startedAt),
  Конец: (session) => stamp(session.endedAt),
  Чат: (session) => String(session.chatId),
  Телефон: (session) => session.phone ?? "",
  Канал: (session) => session.channel,
  Запрос: (session) => session.intent,
  Услуга: (session) => session.service ?? "",
  Мастер: (session) => session.master ?? "",
  "Дошёл до": (session) => session.reached,
  Итог: (session) => session.outcome,
  "Почему сорвалось": (session) => session.breakReason ?? "",
  "ID записи": (_session, bookingId) => bookingId,
  "Вопрос без ответа": (session) => session.unanswered ?? "",
  Сообщений: (session) => String(session.messages),
  Секунд: (session) => String(session.durationSec),
  Имя: (session) => session.name ?? "",
  [SHEET_MARK_COLUMN]: () => SHEET_MARK_VALUE,
};

/**
 * Дописывает строки в конец таблицы.
 *
 * Колонки берём из ШАПКИ владельца, как это делает бот: чего в шапке нет —
 * того мы не создаём и не выдумываем. Единственное исключение — колонка «Демо»:
 * без неё учебную строку не отличить от настоящей, и стирать было бы нечего.
 */
async function writeSheet(
  access: Access,
  sessions: PlannedSession[],
  bookings: Map<string, string>
): Promise<number> {
  let layout = await readLayout(access);

  if (!layout.headers.includes(SHEET_MARK_COLUMN)) {
    const at = columnLetter(layout.headers.length);
    await writeCell(access, `${layout.tab}!${at}1`, SHEET_MARK_COLUMN);
    console.log(`  завёл колонку «${SHEET_MARK_COLUMN}» — ${at}1`);
    layout = { ...layout, headers: [...layout.headers, SHEET_MARK_COLUMN] };
  }

  const rows = sessions.map((session) => {
    const cells = new Array<string>(layout.headers.length).fill("");
    layout.headers.forEach((header, index) => {
      const fill = COLUMNS[header];
      if (fill) cells[index] = fill(session, bookings.get(session.sessionId) ?? "");
    });
    return cells;
  });

  const last = columnLetter(layout.headers.length - 1);
  let written = 0;
  // Пачками: одна простыня на две сотни строк упирается в таймаут чаще, чем хотелось бы.
  for (let at = 0; at < rows.length; at += 100) {
    written += await appendRows(access, `${layout.tab}!A:${last}`, rows.slice(at, at + 100));
  }
  return written;
}

main().catch((error: unknown) => {
  console.error(`\nНе дорисовал: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
