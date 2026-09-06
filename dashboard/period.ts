// Период, за который пульт показывает цифры. ОДИН на весь пульт.
//
// Переключатель живёт одной строкой над счётчиками, а не внутри карточки: фильтр,
// спрятанный в карточку, обманывает — соседние цифры остаются за другой период,
// и сравнивать их нельзя. Переключил — пересчиталось всё разом.
//
// Период приезжает из адреса (?period=30d), поэтому переключатель — обычные ссылки,
// без клиентского кода: страница и так собирается на сервере на каждый запрос.

export type PeriodKey = "today" | "7d" | "30d";

export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "today", label: "сегодня", days: 1 },
  { key: "7d", label: "7 дней", days: 7 },
  { key: "30d", label: "30 дней", days: 30 },
];

export const DEFAULT_PERIOD: PeriodKey = "7d";

export type Period = {
  key: PeriodKey;
  label: string;
  /** Сколько календарных дней в периоде, включая сегодняшний. */
  days: number;
  /**
   * Нижняя граница в том же виде, в каком бот пишет ts: «ГГГГ-ММ-ДД ЧЧ:ММ:СС».
   * В этом формате даты сравниваются как обычный текст — SQLite не нужен разбор дат.
   */
  since: string;
  /**
   * ВСЕ дни периода подряд, включая пустые. График строится по этому списку,
   * а не по тому, что нашлось в базе: пропущенный день молча превращает провал
   * в ровную линию, и график начинает врать.
   */
  dates: string[];
};

/** «ГГГГ-ММ-ДД» по местному времени — тому же, в котором пишет бот. */
export function isoDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Разбирает ?period= из адреса. Мусор и отсутствие — одно и то же: период по умолчанию. */
export function resolvePeriod(raw: unknown): Period {
  const key = PERIODS.find((p) => p.key === raw)?.key ?? DEFAULT_PERIOD;
  const spec = PERIODS.find((p) => p.key === key)!;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - (spec.days - 1));

  const dates: string[] = [];
  for (let i = 0; i < spec.days; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    dates.push(isoDay(day));
  }

  return { key, label: spec.label, days: spec.days, since: `${dates[0]} 00:00:00`, dates };
}

/** Граница «последние сутки» — для сигнала о тишине. От выбранного периода не зависит. */
export function lastDayBoundary(): string {
  const at = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${isoDay(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
