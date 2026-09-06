import { Fragment } from "react";
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
// • Граница учебного и настоящего — пунктирная черта БЕЗ заливки по сторонам.
//   Залить половину графика цветом значит сказать «эта половина хуже»; черта
//   говорит ровно то, что есть: вот здесь данные меняют природу.
// • Всплывающая подсказка не должна быть ЕДИНСТВЕННЫМ способом узнать цифру,
//   поэтому под графиком есть те же данные текстом.

const PLOT_HEIGHT = 88;

export function DayChart({
  title,
  days,
  realFrom,
}: {
  title: string;
  days: CounterDay[];
  /** День, с которого начинается настоящее. Всё левее — учебное. */
  realFrom?: string;
}) {
  const max = Math.max(...days.map((d) => d.count), 0);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  // Пик — первый из максимальных: подписываем ровно один столбик.
  const peak = max > 0 ? days.findIndex((d) => d.count === max) : -1;
  // На длинном периоде подписываем каждый пятый день, иначе подписи сольются.
  const step = days.length <= 10 ? 1 : 5;
  // Черту ставим ПЕРЕД этим столбиком. Первый день периода — не граница:
  // рисовать её вплотную к оси значит сказать «всё настоящее» чертой,
  // которая обычно значит обратное.
  const border = realFrom ? days.findIndex((d) => d.date === realFrom) : -1;
  // Ближе к правому краю подпись не помещается справа от черты — уводим влево.
  const labelOnLeft = border > days.length / 2;

  return (
    <figure className="m-0 space-y-2">
      <figcaption className="text-xs text-muted">{title}</figcaption>

      <div
        role="img"
        aria-label={`${title}: всего ${total} ${plural(total, "обращение", "обращения", "обращений")} за ${days.length} ${plural(days.length, "день", "дня", "дней")}`}
      >
        <div className="relative flex items-end gap-[2px]" style={{ height: PLOT_HEIGHT }}>
          {days.map((day, index) => (
            <Fragment key={day.date}>
              {index === border && index > 0 && (
                /* Ширины у черты нет: она стоит В ЗАЗОРЕ между столбиками
                   и потому не сдвигает и не сужает ни один из них. */
                <span className="relative z-10 w-0 self-stretch border-l border-dashed border-muted/70">
                  <span
                    className={`absolute -top-0.5 whitespace-nowrap text-[10px] leading-3 text-muted ${
                      labelOnLeft ? "right-1 text-right" : "left-1"
                    }`}
                  >
                    отсюда — настоящие данные
                  </span>
                </span>
              )}

              <div
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
            </Fragment>
          ))}
        </div>

        {/* Ось — сплошная волосяная линия на тон от фона, без пунктира. */}
        <div className="mt-1 border-t border-line" />

        <div className="flex gap-[2px] pt-1">
          {days.map((day, index) => (
            <Fragment key={day.date}>
              {/* Пустышка ровно там, где в ряду столбиков стоит черта: без неё
                  зазоры разошлись бы и подписи уехали относительно столбиков. */}
              {index === border && index > 0 && <span className="w-0" />}
              <span className="min-w-0 flex-1 text-center text-[10px] text-muted">
                {index % step === 0 || index === days.length - 1 ? day.date.slice(8) : ""}
              </span>
            </Fragment>
          ))}
        </div>
      </div>

      {/* То же самое словами. Подпись у черты мелкая и может не попасть на глаза,
          а на печати и в озвучке её не видно вовсе — а факт важный. */}
      {border > 0 && (
        <p className="text-[11px] text-muted">
          Пунктир: с {humanDate(days[border].date)} данные настоящие, левее — учебные.
        </p>
      )}

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
