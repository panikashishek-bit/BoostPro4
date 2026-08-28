import { prisma } from "@/lib/prisma";

// Шаг сетки слотов в минутах (начало записи может быть в :00 или :30).
const SLOT_STEP_MIN = 30;

export type Slot = {
  /** Начало слота в ISO-формате (абсолютный момент времени). */
  startISO: string;
  /** Время в формате HH:MM для отображения. */
  label: string;
};

/** weekday: 1 = понедельник ... 7 = воскресенье (как в схеме). */
function weekdayMonFirst(date: Date): number {
  const js = date.getDay(); // 0 = вс ... 6 = сб
  return js === 0 ? 7 : js;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Считает свободные слоты мастера на конкретную дату под услугу заданной длительности.
 * Слоты = окна графика мастера минус пересечения с уже существующими записями.
 */
export async function getAvailableSlots(params: {
  masterId: string;
  durationMin: number;
  date: string; // YYYY-MM-DD
}): Promise<Slot[]> {
  const { masterId, durationMin, date } = params;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return [];

  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const weekday = weekdayMonFirst(dayStart);

  const workingHours = await prisma.workingHour.findMany({
    where: { masterId, weekday },
  });
  if (workingHours.length === 0) return [];

  const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
  const bookings = await prisma.booking.findMany({
    where: {
      masterId,
      status: { not: "CANCELLED" },
      startAt: { gte: dayStart, lte: dayEnd },
    },
    select: { startAt: true, endAt: true },
  });

  const now = new Date();
  const slots: Slot[] = [];

  for (const wh of workingHours) {
    for (let m = wh.startMin; m + durationMin <= wh.endMin; m += SLOT_STEP_MIN) {
      const startAt = new Date(year, month - 1, day, 0, m, 0, 0);
      const endAt = new Date(startAt.getTime() + durationMin * 60_000);

      if (startAt < now) continue; // прошедшее время не предлагаем

      const overlaps = bookings.some((b) => startAt < b.endAt && endAt > b.startAt);
      if (overlaps) continue;

      slots.push({
        startISO: startAt.toISOString(),
        label: `${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
      });
    }
  }

  return slots;
}
