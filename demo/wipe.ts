import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { columnLetter, deleteRows, readLayout, readRange } from "./sheet";
import { EVENT_MARK, SHEET_MARK_COLUMN, SHEET_MARK_VALUE, readAccess, type Access } from "./settings";

// Стереть ВСЮ учебную историю разом: npm run demo:wipe
//
// Команда написана для одного конкретного момента — «завтра показываю пульт
// живым людям, учебных цифр там быть не должно». Поэтому она обязана стирать
// всё и сразу, из всех трёх источников, и не обязана ничего спрашивать.
//
// Единственное правило, которое здесь важнее скорости: удаляется ТОЛЬКО то,
// на чём стоит метка. Ни одного условия по датам, по номерам чатов или по
// «похоже на учебное» — только метка, поставленная при записи. Настоящие
// строки владельца не совпадут с ней никогда, потому что их не помечает никто.

async function main(): Promise<void> {
  const access = readAccess();
  const prisma = new PrismaClient();

  try {
    // Таблица идёт ПЕРВОЙ, хотя она же и самая медленная. Это единственный шаг,
    // который ходит по сети, и единственный, который может оборваться на середине.
    // Упади он первым — не удалено ещё ничего, и повторный запуск начинает с нуля.
    // Стирай мы её последней, обрыв оставил бы пустые лог с базой и полную строк
    // таблицу: состояние, в котором цифры трёх источников не сходятся.
    const rows = await wipeSheet(access);
    const events = wipeEvents(access);
    const bookings = await prisma.booking.deleteMany({ where: { isDemo: true } });

    console.log("Стёрто:");
    console.log(`  лог событий      ${events.removed} строк (осталось настоящих: ${events.left})`);
    console.log(`  база приложения  ${bookings.count} записей`);
    console.log(`  Google-таблица   ${rows.removed} строк (осталось настоящих: ${rows.left})`);
    console.log("");
    console.log("Учебных данных больше нет. Всё, что осталось, — настоящее.");
  } finally {
    await prisma.$disconnect();
  }
}

/** Лог событий: удаляем строки с меткой, считаем оставшиеся. */
function wipeEvents(access: Access): { removed: number; left: number } {
  const db = new DatabaseSync(access.eventsDbPath);

  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const result = db.prepare("DELETE FROM events WHERE is_demo = ?").run(EVENT_MARK);
    const left = Number((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n);
    return { removed: Number(result.changes), left };
  } catch (error) {
    const message = (error as Error)?.message ?? "";
    // Базы или таблицы нет — стирать нечего, и это не повод падать: остальные
    // два источника почистить всё равно надо.
    if (/no such table|unable to open/i.test(message)) return { removed: 0, left: 0 };
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Google-таблица: удаляем строки, у которых в колонке «Демо» стоит «да».
 *
 * Номера строк собираем ПО ФАКТУ, из самой таблицы, а не по счёту дописанных:
 * между записью и удалением владелец мог что-то вставить или отсортировать,
 * и запомненные номера уехали бы на чужие строки.
 */
async function wipeSheet(access: Access): Promise<{ removed: number; left: number }> {
  const layout = await readLayout(access);
  const at = layout.headers.indexOf(SHEET_MARK_COLUMN);

  if (at === -1) {
    console.log(`  (колонки «${SHEET_MARK_COLUMN}» в таблице нет — значит и учебных строк в ней нет)`);
    return { removed: 0, left: 0 };
  }

  const letter = columnLetter(at);
  const column = await readRange(access, `${layout.tab}!${letter}:${letter}`);

  const doomed: number[] = [];
  // Первая строка — шапка, её не трогаем ни при каких обстоятельствах.
  for (let index = 1; index < column.length; index += 1) {
    if (String(column[index]?.[0] ?? "").trim().toLowerCase() === SHEET_MARK_VALUE) {
      doomed.push(index + 1);
    }
  }

  await deleteRows(access, layout.tabId, doomed);

  const left = Math.max(0, column.length - 1 - doomed.length);
  return { removed: doomed.length, left };
}

main().catch((error: unknown) => {
  console.error(`\nНе стёр: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
