import { prisma } from "@/lib/prisma";
import { formatRub, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="space-y-5">
        <span className="inline-flex items-center rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
          Онлайн-запись
        </span>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Запишитесь
          <br />
          за минуту
        </h1>
        <p className="max-w-md text-base text-muted">
          Выберите услугу, мастера и удобное время. Без звонков и переписок.
        </p>
        <a
          href="/book"
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          Записаться
          <span aria-hidden>→</span>
        </a>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Наши услуги</h2>
        {services.length === 0 ? (
          <p className="text-sm text-muted">
            Услуг пока нет. Запустите{" "}
            <code className="rounded bg-brand-soft px-1 text-brand">npm run db:seed</code>.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {services.map((s) => (
              <li key={s.id}>
                <a
                  href={`/book?service=${s.id}`}
                  className="group flex h-full items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-5 transition hover:border-brand/40 hover:shadow-[0_4px_24px_-12px_rgba(14,124,102,0.35)]"
                >
                  <div>
                    <h3 className="font-medium text-ink">{s.name}</h3>
                    {s.description && <p className="mt-1 text-sm text-muted">{s.description}</p>}
                    <span className="mt-2 inline-block text-sm font-medium text-brand opacity-0 transition group-hover:opacity-100">
                      Записаться →
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold text-ink">{formatRub(s.priceRub)}</div>
                    <div className="text-xs text-muted">{formatDuration(s.durationMin)}</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
