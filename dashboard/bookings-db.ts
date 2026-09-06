import { PrismaClient } from "@prisma/client";
import type { DashboardEnv } from "./config";

// Доступ пульта к базе записей приложения.
//
// ⚠️ ЕДИНСТВЕННЫЙ файл пульта, который знает про приложение. Все остальные
// работают на встроенных модулях Node и на fetch — папку можно скопировать
// в любой проект на Next.js, и она заведётся. С этим файлом так уже не выйдет:
// он требует @prisma/client и таблицу Booking. Поэтому знание собрано ЗДЕСЬ
// целиком: переносишь пульт в другой проект — удаляешь этот файл и строку
// счётчика «Сверка» в counters/registry.ts, остальное поедет как было.
//
// ПУЛЬТ ТОЛЬКО ЧИТАЕТ. К адресу базы дописывается default_transaction_read_only=on,
// и обычный запрос на запись отбивает сам PostgreSQL (ERROR 25006), а не наша
// аккуратность: ни create/update/delete, ни сырой SQL через этот клиент не пройдут.
//
// ⚠️ Но честно про предел: это СЕССИОННАЯ НАСТРОЙКА, а не право роли. Код, который
// откроет транзакцию явным BEGIN READ WRITE, снимет её с себя — PostgreSQL это
// разрешает. То есть от случайной записи защита есть, от намеренной — нет, и в этом
// она слабее двух соседних (SQLite readOnly и scope readonly у Google непреодолимы
// для клиента вообще).
//
// Как сделать её настоящей: отдельная роль в PostgreSQL с одним GRANT SELECT и без
// прав на запись. Тогда BEGIN READ WRITE тоже упрётся в permission denied. Пока роли
// нет, правило простое: в ЭТОМ файле пишутся только чтения, и заводить транзакции
// здесь нельзя.

export const BOOKINGS_DB_VARIABLE = "BOOKINGS_DB_URL";

/** Комментарий, которым бот метит СВОИ записи (bot_administrator/src/tools.ts). */
export const BOT_COMMENT = "Запись через Telegram-бота";

/**
 * Соединение только на чтение.
 *
 * Кладём параметр сами, а не просим владельца дописать его в .env: пропущенный
 * хвост в строке подключения не виден глазом, и пульт молча получил бы право
 * писать в боевую базу. Заданный в адресе руками — перетираем своим.
 */
const READ_ONLY = `options=${encodeURIComponent("-c default_transaction_read_only=on")}`;

function readOnlyUrl(raw: string): string {
  const [base, query = ""] = raw.split("?");
  const kept = query.split("&").filter((part) => part && !part.startsWith("options="));
  return `${base}?${[...kept, READ_ONLY].join("&")}`;
}

/**
 * Один клиент на процесс.
 *
 * Свой, а не singleton приложения (src/lib/prisma.ts) — по той же причине, по
 * которой пульт не читает чужие .env: связь должна идти в одну сторону и жить
 * в одном файле. Цена — второй пул соединений; на фоне того, что приложение
 * и так держит свой, это единицы подключений, а не десятки.
 *
 * На globalThis, потому что в dev-режиме Next перезагружает модули на каждую
 * правку, и без этого пул рос бы с каждым сохранением файла.
 *
 * ⚠️ Ключ кэша — САМ АДРЕС, а не просто «клиент уже есть». Пульт перечитывает
 * .env на каждый запрос ровно затем, чтобы поправленный файл был виден по F5.
 * Держи мы клиент без привязки к адресу — владелец исправил бы строку
 * подключения, обновил страницу и увидел прежнюю ошибку, а мы бы продолжали
 * ходить по старому адресу до перезапуска сервера.
 */
const cache = globalThis as unknown as { dashboardBookings?: { url: string; db: PrismaClient } };

function client(url: string): PrismaClient {
  const target = readOnlyUrl(url);
  const kept = cache.dashboardBookings;
  if (kept?.url === target && kept.db) return kept.db;

  // Адрес сменился — старый пул больше не нужен. Закрываем, не дожидаясь ответа:
  // висящее соединение к недоступной базе может отвечать долго, а страница ждать
  // этого не должна.
  //
  // Через ?. насквозь: в dev-режиме на globalThis может лежать значение, которое
  // положила ПРЕДЫДУЩАЯ версия этого файла, — горячая перезагрузка меняет код,
  // но не то, что уже сохранено рядом с процессом. Обращение к полю по памяти
  // о старой форме роняет счётчик так, что причина выглядит совершенно посторонней.
  void kept?.db?.$disconnect?.().catch(() => {});

  const db = new PrismaClient({ datasourceUrl: target, log: ["error"] });
  cache.dashboardBookings = { url: target, db };
  return db;
}

export type BookingsResult =
  | { ok: true; db: PrismaClient }
  | { ok: false; problem: string };

/**
 * Открывает базу записей. Не бросает: пульт обязан уметь показать «не подключено»
 * строкой, а не пятисотой — иначе владелец не отличит «не настроено» от «сломалось».
 */
export function openBookingsDb(env: DashboardEnv): BookingsResult {
  const url = env.get(BOOKINGS_DB_VARIABLE);
  if (!url) {
    return {
      ok: false,
      problem: `переменная ${BOOKINGS_DB_VARIABLE} не задана в dashboard/.env — это адрес базы приложения, тот же, что в DATABASE_URL`,
    };
  }
  return { ok: true, db: client(url) };
}

export type BookingRow = {
  id: string;
  createdAt: Date;
  status: string;
  /** Учебная запись, дорисованная npm run demo:seed. */
  isDemo: boolean;
};

/** То же плюс признак «сделана ботом» — он нужен только при подсчёте за период. */
export type CreatedBooking = BookingRow & { byBot: boolean };

/**
 * Записи, созданные за период. Всё, что нужно сверке, и ни одного лишнего поля.
 *
 * Ничего не отфильтровано: и учебное, и записи с сайта возвращаются как есть.
 * Решать, что показывать, — дело счётчика: он один знает, включён ли показ демо,
 * и раздели мы это на два места, две цифры на карточке однажды разъехались бы.
 */
export async function bookingsCreatedIn(
  db: PrismaClient,
  since: Date,
  until: Date
): Promise<CreatedBooking[]> {
  const rows = await db.booking.findMany({
    where: { createdAt: { gte: since, lt: until } },
    select: { id: true, createdAt: true, status: true, isDemo: true, comment: true },
  });

  // Записи с сайта бот не делал и доложить о них не мог. Отличаем по комментарию,
  // который бот ставит сам, — другого признака происхождения у записи нет.
  return rows.map(({ comment, ...row }) => ({ ...row, byBot: comment === BOT_COMMENT }));
}

/**
 * Ищет записи по их идентификаторам — тем, что бот назвал клиенту.
 * Чего нет в ответе, того нет и в базе: это и есть «потерянная запись».
 */
export async function bookingsByIds(db: PrismaClient, ids: string[]): Promise<Map<string, BookingRow>> {
  if (ids.length === 0) return new Map();

  const rows = await db.booking.findMany({
    where: { id: { in: ids } },
    select: { id: true, createdAt: true, status: true, isDemo: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}
