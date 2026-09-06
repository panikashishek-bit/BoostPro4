import type { Counter, CounterContext, CounterValue } from "./types";
import { sessionsCounter } from "./sessions";

// Список счётчиков командного центра.
//
// Пока пуст — данных ещё нет, и пульт честно показывает пустое место
// вместо выдуманных цифр.
//
// Чтобы добавить счётчик:
//   1. создай рядом файл, например bookings-week.ts;
//   2. экспортируй из него объект типа Counter (см. types.ts);
//   3. допиши его в массив ниже.
// Ни другие счётчики, ни page.tsx, ни код приложения трогать не нужно.
//
// Порядок в списке — порядок карточек на странице.

export const COUNTERS: Counter[] = [sessionsCounter];

export type CollectedCounter = {
  counter: Counter;
  value: CounterValue | null;
  /** Почему данных нет. Показывается вместо цифры, спокойным языком. */
  problem?: string;
};

/**
 * Собирает все счётчики. Каждый — в своём try: упавший показывает «нет данных»,
 * соседи считаются как ни в чём не бывало.
 *
 * Promise.all, а не последовательный цикл: счётчики независимы, и ждать
 * их по очереди значит складывать все задержки в одну.
 */
export async function collectCounters(ctx: CounterContext): Promise<CollectedCounter[]> {
  return Promise.all(
    COUNTERS.map(async (counter) => {
      try {
        return { counter, value: await counter.collect(ctx) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { counter, value: null, problem: reason };
      }
    })
  );
}
