import { cookies } from "next/headers";
import { login, logout } from "./actions";
import BookingsTab from "./BookingsTab";
import ServicesTab from "./ServicesTab";
import TeamTab from "./TeamTab";

export const dynamic = "force-dynamic";

type Tab = "bookings" | "services" | "team";

const TABS: { key: Tab; label: string }[] = [
  { key: "bookings", label: "Записи" },
  { key: "services", label: "Услуги" },
  { key: "team", label: "Команда" },
];

async function isAuthed(): Promise<boolean> {
  const cookie = (await cookies()).get("admin_auth")?.value;
  return Boolean(cookie && cookie === process.env.ADMIN_PASSWORD);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!(await isAuthed())) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="font-display text-2xl font-bold text-ink">Вход в админку</h1>
        <form action={login} className="space-y-3">
          <input
            type="password"
            name="password"
            placeholder="Пароль"
            className="block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
          />
          <button className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">
            Войти
          </button>
        </form>
        <p className="text-xs text-muted">
          Пароль задаётся в переменной <code className="text-brand">ADMIN_PASSWORD</code> (см. .env).
        </p>
      </div>
    );
  }

  const { tab } = await searchParams;
  const active: Tab = tab === "services" ? "services" : tab === "team" ? "team" : "bookings";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Админка</h1>
        <form action={logout}>
          <button className="-mx-2 inline-flex min-h-11 items-center px-2 text-sm text-muted transition hover:text-ink">
            Выйти
          </button>
        </form>
      </div>

      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={`/admin?tab=${t.key}`}
            className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition ${
              active === t.key
                ? "border-brand text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {active === "bookings" && <BookingsTab />}
      {active === "services" && <ServicesTab />}
      {active === "team" && <TeamTab />}
    </div>
  );
}
