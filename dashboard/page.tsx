import {
  readDashboardEnv,
  dashboardPassword,
  DEFAULT_PASSWORD,
  type DashboardEnv,
} from "./config";
import { resolvePeriod, PERIODS, type Period, type PeriodKey } from "./period";
import { countDemo, dashboardHref, resolveDemo, type Demo } from "./demo";
import { DayChart } from "./day-chart";
import type { Counter } from "./counters/types";
import { isAuthed } from "./auth";
import { login, logout } from "./actions";
import { plural } from "./plural";
import { runHealthChecks, type CheckedSource } from "./health/registry";
import { collectCounters, COUNTERS, type CollectedCounter } from "./counters/registry";
import type { HealthState } from "./health/types";

// Страница пульта целиком. Живёт здесь, а не в src/app/: точка подключения
// в приложении — три строки, которые просто зовут эту функцию.
//
// Всё собирается на каждый запрос: внутри нет ни одного кэша, а сам маршрут
// объявлен force-dynamic в точке подключения (src/app/dashboard/page.tsx).
// Объявление живёт там нарочно: Next читает настройки маршрута из файла самого
// маршрута, и переэкспорт отсюда он может не заметить — страница тихо начала бы
// кэшироваться, то есть показывать вчерашние цифры с уверенным видом.

export default async function DashboardPage({
  searchParams,
}: {
  // Период приезжает адресом (?period=30d). Next отдаёт searchParams самой странице,
  // поэтому точку подключения в приложении трогать не пришлось.
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const env = readDashboardEnv();

  if (!(await isAuthed())) {
    return <LoginScreen env={env} />;
  }

  const query = await searchParams;
  const period = resolvePeriod(query?.period);
  const demo = resolveDemo(query?.demo);

  // Проверки и счётчики независимы — считаем их разом, а не по очереди.
  const [checks, counters] = await Promise.all([
    runHealthChecks(env),
    collectCounters({ env, period, demo }),
  ]);

  // Сколько учебного попало в цифры. Считается ВСЕГДА, даже когда показ демо
  // выключен: тогда плашка говорит не «в цифрах есть выдумка», а «выдумка
  // спрятана» — и это тоже надо сказать, иначе человек не поймёт, куда делся
  // месяц истории.
  const drawn = countDemo(env, period);

  return (
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Пульт</h1>
          <p className="mt-1 text-sm text-muted">
            Собрано {new Date().toLocaleTimeString("ru-RU")} — обновляется на каждый F5.
          </p>
        </div>
        <form action={logout}>
          <button className="-mx-2 inline-flex min-h-11 items-center px-2 text-sm text-muted transition hover:text-ink">
            Выйти
          </button>
        </form>
      </header>

      <DemoBanner drawn={drawn} period={period} demo={demo} />

      <ConnectionCheck env={env} checks={checks} />
      <CommandCentre counters={counters} period={period} demo={demo} />
    </div>
  );
}

// --- Вход ---

/**
 * Экран входа. Показывает не только форму, но и состояние файла настроек.
 *
 * Это важнее, чем кажется: .env не едет деплоем, его кладут на сервер руками.
 * Если файла нет, пароль не подойдёт никакой — и без этой строки человек час
 * ищет ошибку в коде вместо того, чтобы просто доложить файл.
 */
function LoginScreen({ env }: { env: DashboardEnv }) {
  const password = dashboardPassword(env);

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">Вход в пульт</h1>

      <form action={login} className="space-y-3">
        <input
          type="password"
          name="password"
          placeholder="Пароль"
          autoComplete="current-password"
          className="block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">
          Войти
        </button>
      </form>

      {!env.found ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-2.5 text-xs text-muted">
          Файл настроек пульта не прочитан: {env.problem}.
          <br />
          Пока его нет, не подойдёт ни один пароль — дело не в пароле.
        </p>
      ) : !password ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-2.5 text-xs text-muted">
          Файл настроек на месте, но <code className="text-brand">DASHBOARD_PASSWORD</code> в нём
          пуст — войти нельзя, пока в него не вписан пароль.
        </p>
      ) : (
        <p className="text-xs text-muted">
          Пароль задаётся в <code className="text-brand">DASHBOARD_PASSWORD</code> — файл{" "}
          <code className="text-brand">dashboard/.env</code>.
        </p>
      )}
    </div>
  );
}

// --- Проверка связи ---

const STATE_STYLE: Record<HealthState, { dot: string; label: string }> = {
  ok: { dot: "bg-brand", label: "на связи" },
  missing: { dot: "bg-line ring-1 ring-muted/40", label: "не подключено" },
  broken: { dot: "bg-amber-500", label: "не читается" },
};

function ConnectionCheck({ env, checks }: { env: DashboardEnv; checks: CheckedSource[] }) {
  const standardPassword = dashboardPassword(env) === DEFAULT_PASSWORD;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Проверка связи</h2>
      <p className="text-sm text-muted">
        Что пульт видит, а чего нет. Строка становится зелёной, когда источник реально
        подключён, — не раньше.
      </p>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {checks.map(({ source, report }) => {
          const style = STATE_STYLE[report.state];
          return (
            <li key={source.id} className="flex gap-3 px-4 py-3.5">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm text-ink">
                  {source.title} — <span className="text-muted">{style.label}</span>
                </p>
                <p className="break-words text-xs text-muted">{report.detail}</p>
              </div>
            </li>
          );
        })}

        {/* Отдельная строка про пароль: это не источник данных, а напоминание.
            Пульт висит в открытом интернете, и стандартный пароль на нём —
            вопрос времени, а не удачи. */}
        {standardPassword && (
          <li className="flex gap-3 px-4 py-3.5">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm text-ink">
                пароль стандартный (admin) — <span className="text-muted">пора сменить</span>
              </p>
              <p className="text-xs text-muted">
                Заведёшь сюда настоящих клиентов — смени <code>DASHBOARD_PASSWORD</code> в{" "}
                <code>dashboard/.env</code>.
              </p>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

// --- Командный центр ---

/**
 * Плашка про учебные строки.
 *
 * Стоит в шапке, а не под счётчиками, и висит, пока учебное в периоде есть.
 * Правило простое: пульт, показавший дорисованную историю молча, — это пульт,
 * которому больше нельзя верить ни в чём. Один раз обмануться на своих же
 * цифрах дороже, чем каждый день видеть эту строку.
 */
function DemoBanner({
  drawn,
  period,
  demo,
}: {
  drawn: { sessions: number; events: number } | null;
  period: Period;
  demo: Demo;
}) {
  if (!drawn || drawn.sessions === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs text-ink">
      <span aria-hidden>⚠</span>
      {demo.show ? (
        <span>
          Включая {drawn.sessions}{" "}
          {plural(drawn.sessions, "учебное обращение", "учебных обращения", "учебных обращений")} (
          {drawn.events} {plural(drawn.events, "строка", "строки", "строк")} в логе) — это не
          настоящие данные.
        </span>
      ) : (
        <span>
          Учебные строки скрыты: {drawn.sessions}{" "}
          {plural(drawn.sessions, "обращение", "обращения", "обращений")} за этот период не
          показаны. Здесь только настоящее.
        </span>
      )}
      <a href={dashboardHref(period.key, { show: !demo.show })} className="text-brand underline">
        {demo.show ? "показать только настоящее" : "вернуть учебные"}
      </a>
      <span className="text-muted">стереть насовсем: npm run demo:wipe</span>
    </p>
  );
}

function CommandCentre({
  counters,
  period,
  demo,
}: {
  counters: CollectedCounter[];
  period: Period;
  demo: Demo;
}) {
  return (
    <section className="space-y-4">
      {/* Переключатель периода стоит ОДНОЙ строкой над всеми счётчиками, а не внутри
          карточки. Фильтр, спрятанный в карточку, обманывает: соседние цифры остаются
          за другой период, и сравнивать их уже нельзя. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Мой командный центр</h2>
        <div className="flex flex-wrap items-center gap-2">
          <DemoSwitch period={period} demo={demo} />
          <PeriodSwitch active={period.key} demo={demo} />
        </div>
      </div>

      {COUNTERS.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-10 text-center">
          <p className="text-sm text-muted">Здесь появятся счётчики.</p>
          <p className="mt-1 text-xs text-muted">
            Пока их нет — сначала подключаем источники выше.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {counters.map(({ counter, value, problem }) => (
            <div
              key={counter.id}
              className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${
                value?.chart ? "sm:col-span-2" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted">{counter.title}</p>
                <CounterInfo counter={counter} />
              </div>

              {value ? (
                <>
                  {/* Крупная цифра — обычным шрифтом текста и без моноширинных цифр:
                      акцидентный шрифт на числе читается как украшение, а равная
                      ширина знаков делает короткое число рыхлым. */}
                  <p className="mt-1 text-3xl font-bold tracking-tight text-ink">{value.value}</p>
                  {value.caption && <p className="mt-0.5 text-sm text-muted">{value.caption}</p>}
                  {value.figures?.length ? <Figures figures={value.figures} /> : null}
                  {value.notes?.length ? <Notes notes={value.notes} /> : null}
                  {value.cases?.length ? <Cases cases={value.cases} /> : null}
                  {value.chart && (
                    <div className="mt-5">
                      <DayChart
                        title={value.chart.title}
                        days={value.chart.days}
                        realFrom={value.chart.realFrom}
                      />
                    </div>
                  )}
                </>
              ) : (
                /* Счётчик упал — здесь «нет данных», а соседи и страница живут дальше. */
                <>
                  <p className="mt-1 text-3xl font-bold text-muted">нет данных</p>
                  {problem && <p className="mt-0.5 break-words text-xs text-muted">{problem}</p>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Период, сигналы и пояснение ---

function PeriodSwitch({ active, demo }: { active: PeriodKey; demo: Demo }) {
  return (
    <nav aria-label="Период" className="flex gap-1 rounded-xl border border-line bg-surface p-1">
      {PERIODS.map((p) => (
        <a
          key={p.key}
          // Ссылка несёт ОБА переключателя: иначе смена периода молча включала бы
          // учебные строки обратно, и человек смотрел бы не на то, что выбрал.
          href={dashboardHref(p.key, demo)}
          aria-current={p.key === active ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm transition ${
            p.key === active
              ? "bg-brand-soft font-medium text-brand"
              : "text-muted hover:bg-brand-soft hover:text-brand"
          }`}
        >
          {p.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Переключатель «показывать демо».
 *
 * Обычная ссылка с состоянием в адресе, как и период: страница собирается
 * на сервере на каждый запрос, клиентский код тут не нужен.
 */
function DemoSwitch({ period, demo }: { period: Period; demo: Demo }) {
  return (
    <a
      href={dashboardHref(period.key, { show: !demo.show })}
      aria-pressed={demo.show}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm transition ${
        demo.show ? "bg-brand-soft text-brand" : "bg-surface text-muted hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-2 rounded-full ${demo.show ? "bg-brand" : "bg-line ring-1 ring-muted/40"}`}
      />
      показывать демо
    </a>
  );
}

/**
 * Несколько чисел в ряд.
 *
 * Стоят рядом и одинаковым кеглем нарочно: смысл в их сравнении, и стоит
 * выделить одно — глаз начнёт считать его главным, а главного среди них нет.
 */
function Figures({ figures }: { figures: NonNullable<CollectedCounter["value"]>["figures"] }) {
  return (
    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
      {figures?.map((figure) => (
        <div key={figure.label}>
          <dt className="text-xs text-muted">{figure.label}</dt>
          <dd className="text-lg font-semibold text-ink">{figure.value}</dd>
          {figure.note && <dd className="text-[11px] text-muted">{figure.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Список случаев к разбору.
 *
 * Тревожные видно сразу, спокойные — тоже здесь, но тише: разница между
 * «человек придёт к закрытой двери» и «в журнал не попало» слишком велика,
 * чтобы показывать их одинаково. Смысл несёт текст, цвет только подчёркивает.
 *
 * Первые пять открыты, остальные — под «показать все»: список на сотню строк
 * никто не читает, а первые пять читают всегда.
 */
function Cases({ cases }: { cases: NonNullable<CollectedCounter["value"]>["cases"] }) {
  const all = cases ?? [];
  const head = all.slice(0, 5);
  const rest = all.slice(5);

  return (
    <div className="mt-4 space-y-2">
      <ul className="space-y-2">
        {head.map((one) => (
          <CaseRow key={one.id} one={one} />
        ))}
      </ul>

      {rest.length > 0 && (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-brand">
            Показать остальные {rest.length}
          </summary>
          <ul className="mt-2 space-y-2">
            {rest.map((one) => (
              <CaseRow key={one.id} one={one} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CaseRow({ one }: { one: NonNullable<NonNullable<CollectedCounter["value"]>["cases"]>[number] }) {
  return (
    <li
      className={`rounded-xl border px-3 py-2.5 text-xs ${
        one.tone === "alarm" ? "border-amber-500/40 bg-amber-500/5" : "border-line bg-surface"
      }`}
    >
      <p className="flex flex-wrap items-center gap-x-2 text-ink">
        <span aria-hidden className={one.tone === "alarm" ? "text-amber-600" : "text-muted"}>
          {one.tone === "alarm" ? "⚠" : "·"}
        </span>
        <span className="font-medium">{one.title}</span>
        {one.demo && (
          <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">
            учебная строка
          </span>
        )}
      </p>
      <p className="mt-1 text-muted">{one.detail}</p>
      {one.gist && <p className="mt-0.5 text-muted">Спрашивал: {one.gist}</p>}
    </li>
  );
}

/**
 * Сигналы к действию под цифрой.
 *
 * Смысл несёт текст, а не цвет: строку должно быть понятно и в чёрно-белой печати,
 * и тому, кто не различает оттенки. Цвет только подчёркивает.
 */
function Notes({ notes }: { notes: NonNullable<CollectedCounter["value"]>["notes"] }) {
  return (
    <ul className="mt-3 space-y-1.5">
      {notes?.map((note, index) => (
        <li key={index} className="flex gap-2 text-xs">
          <span aria-hidden className={note.tone === "alarm" ? "text-amber-600" : "text-muted"}>
            {note.tone === "alarm" ? "⚠" : "·"}
          </span>
          <span className={note.tone === "alarm" ? "text-ink" : "text-muted"}>{note.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Значок ℹ️ у счётчика: по клику — откуда данные, как считается, что значит сигнал.
 *
 * Обычный details, без клиентского кода. Панель всплывает поверх карточки, а не
 * раздвигает её: иначе цифра прыгала бы вниз при каждом открытии.
 */
function CounterInfo({ counter }: { counter: Counter }) {
  return (
    <details className="relative shrink-0">
      <summary
        className="inline-flex min-h-11 cursor-pointer list-none items-center px-1 text-muted transition hover:text-brand [&::-webkit-details-marker]:hidden"
        aria-label={`Как считается «${counter.title}»`}
        title={`Как считается «${counter.title}»`}
      >
        {"ℹ️"}
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-80 max-w-[78vw] space-y-2 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-muted shadow-lg">
        {counter.info.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </details>
  );
}
