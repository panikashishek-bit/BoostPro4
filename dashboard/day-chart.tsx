import type { CounterDay } from "./counters/types";
import { plural } from "./plural";

// График по дням: один столбик — один день.
//
// Правила, по которым он нарисован:
// • Ряд один — значит и цвет один на все столбики. Красить столбики «темнее там,
//   где больше» нельзя: это второй раз кодирует ту же длину и сжигает единственный
//   свободный канал на то, что уже видно.
// • Пустые дни рисуются засечкой на нуле, а не пропускаются. Пропущенный день
//   склеил бы соседние и превратил провал в ровный ряд — график бы врал.
// • Столбики разделяет зазор цвета фона, а не рамка: рамка добавляет чернил,
//   которые не несут данных.
// • Подпись ставится только над пиком. Число над каждым столбиком не читают.
// • Всплывающая подсказка не должна быть ЕДИНСТВЕННЫМ способом узнать цифру,
//   поэтому под графиком есть те же данные текстом.

const PLOT_HEIGHT = 88;

export function DayChart({ title, days }: { title: string; days: CounterDay[] }) {
  const max = Math.max(...days.map((d) => d.count), 0);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  // Пик — первый из максимальных: подписываем ровно один столбик.
  const peak = max > 0 ? days.findIndex((d) => d.count === max) : -1;
  // На длинном периоде подписываем каждый пятый день, иначе подписи сольются.
  const step = days.length <= 10 ? 1 : 5;

  return (
    <figure className="m-0 space-y-2">
      <figcaption className="text-xs text-muted">{title}</figcaption>

      <div
        role="img"
        aria-label={`${title}: всего ${total} ${plural(total, "обращение", "обращения", "обращений")} за ${days.length} ${plural(days.length, "день", "дня", "дней")}`}
      >
        <div className="flex items-end gap-[2px]" style={{ height: PLOT_HEIGHT }}>
          {days.map((day, index) => (
            <div
              key={day.date}
              className="flex min-w-0 flex-1 flex-col justify-end gap-1"
              title={`${humanDate(day.date)} — ${day.count} ${plural(day.count, "обращение", "обращения", "обращений")}`}
            >
              {/* Место под подпись занято всегда — иначе подписанный столбик
                  оказался бы ниже соседей и пик читался бы меньше, чем он есть. */}
              <span className="h-3 text-center text-[10px] leading-3 text-muted">
                {index === peak ? day.count : ""}
              </span>

              {day.count === 0 ? (
                <span className="block h-[2px] w-full rounded-full bg-line" />
              ) : (
                <span
                  className="block w-full rounded-t-[4px] bg-brand"
                  style={{ height: `${Math.max(3, (day.count / max) * (PLOT_HEIGHT - 16))}px` }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Ось — сплошная волосяная линия на тон от фона, без пунктира. */}
        <div className="mt-1 border-t border-line" />

        <div className="flex gap-[2px] pt-1">
          {days.map((day, index) => (
            <span key={day.date} className="min-w-0 flex-1 text-center text-[10px] text-muted">
              {index % step === 0 || index === days.length - 1 ? day.date.slice(8) : ""}
            </span>
          ))}
        </div>
      </div>

      <details className="text-xs text-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-brand">
          Показать цифрами
        </summary>
        <ul className="mt-1 space-y-0.5">
          {days.map((day) => (
            <li key={day.date}>
              {humanDate(day.date)} — {day.count}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}

/** «2026-09-06» → «6 сентября». Дата в графике читается человеком, а не машиной. */
function humanDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}
