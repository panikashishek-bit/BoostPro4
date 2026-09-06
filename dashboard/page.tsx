import { readDashboardEnv, dashboardPassword, DEFAULT_PASSWORD, type DashboardEnv } from "./config";
import { isAuthed } from "./auth";
import { login, logout } from "./actions";
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

export default async function DashboardPage() {
  const env = readDashboardEnv();

  if (!(await isAuthed())) {
    return <LoginScreen env={env} />;
  }

  // Проверки и счётчики независимы — считаем их разом, а не по очереди.
  const [checks, counters] = await Promise.all([runHealthChecks(env), collectCounters(env)]);

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

      <ConnectionCheck env={env} checks={checks} />
      <CommandCentre counters={counters} />
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

function CommandCentre({ counters }: { counters: CollectedCounter[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Мой командный центр</h2>

      {COUNTERS.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-10 text-center">
          <p className="text-sm text-muted">Здесь появятся счётчики.</p>
          <p className="mt-1 text-xs text-muted">
            Пока их нет — сначала подключаем источники выше.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {counters.map(({ counter, value, problem }) => (
            <div key={counter.id} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">{counter.title}</p>
              {value ? (
                <>
                  <p className="mt-1 font-display text-2xl font-bold text-ink">{value.value}</p>
                  {value.caption && <p className="mt-0.5 text-xs text-muted">{value.caption}</p>}
                </>
              ) : (
                /* Счётчик упал — здесь «нет данных», а соседи и страница живут дальше. */
                <>
                  <p className="mt-1 font-display text-2xl font-bold text-muted">нет данных</p>
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
