import { prisma } from "@/lib/prisma";
import { formatRub, formatDuration } from "@/lib/format";
import { addService, toggleService, setServiceMasters } from "./actions";

const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand";
const saveBtn =
  "inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-xs font-medium text-ink transition hover:border-brand/50 hover:bg-brand-soft hover:text-brand";

export default async function ServicesTab() {
  const [services, masters] = await Promise.all([
    prisma.service.findMany({ orderBy: { name: "asc" }, include: { masters: true } }),
    prisma.master.findMany({ orderBy: { name: "asc" } }),
  ]);
  const activeMasters = masters.filter((m) => m.isActive);
  const masterName = (id: string) => masters.find((m) => m.id === id)?.name ?? "—";

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">Услуги</h2>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {services.map((s) => {
          const assigned = new Set(s.masters.map((ms) => ms.masterId));
          return (
            <li key={s.id} className="space-y-2 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className={s.isActive ? "" : "text-muted"}>
                  <div className="font-medium text-ink">{s.name}</div>
                  <div className="text-xs text-muted">
                    {formatRub(s.priceRub)} · {formatDuration(s.durationMin)}
                  </div>
                </div>
                <form action={toggleService}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="-mx-2 inline-flex min-h-11 items-center whitespace-nowrap px-2 text-xs font-medium text-muted transition hover:text-ink">
                    {s.isActive ? "Скрыть" : "Включить"}
                  </button>
                </form>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  Мастера:{" "}
                  {assigned.size === 0 ? (
                    <span className="text-amber-600">не назначены — услуга не появится в записи</span>
                  ) : (
                    [...assigned].map(masterName).join(", ")
                  )}
                </summary>
                <form action={setServiceMasters} className="mt-2 space-y-2">
                  <input type="hidden" name="serviceId" value={s.id} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {masters.map((m) => (
                      <label key={m.id} className="flex min-h-11 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          name="masterIds"
                          value={m.id}
                          defaultChecked={assigned.has(m.id)}
                          className="h-5 w-5 accent-brand"
                        />
                        <span className={m.isActive ? "text-ink" : "text-muted"}>
                          {m.name}
                          {m.isActive ? "" : " (скрыт)"}
                        </span>
                      </label>
                    ))}
                  </div>
                  <button className={saveBtn}>Сохранить</button>
                </form>
              </details>
            </li>
          );
        })}
      </ul>

      {/* Добавление услуги */}
      <form
        action={addService}
        className="space-y-3 rounded-2xl border border-dashed border-line p-4"
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Название
            <input name="name" required className={`mt-1 block ${inputClass}`} />
          </label>
          <label className="text-xs text-muted">
            Цена, ₽
            <input
              name="priceRub"
              type="number"
              min="0"
              required
              className={`mt-1 block w-28 ${inputClass}`}
            />
          </label>
          <label className="text-xs text-muted">
            Длит., мин
            <input
              name="durationMin"
              type="number"
              min="1"
              required
              className={`mt-1 block w-28 ${inputClass}`}
            />
          </label>
        </div>

        {activeMasters.length > 0 && (
          <fieldset className="text-xs text-muted">
            <legend className="mb-1.5">Кто оказывает услугу</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {activeMasters.map((m) => (
                <label key={m.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="masterIds" value={m.id} className="h-5 w-5 accent-brand" />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <button className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">
          Добавить услугу
        </button>
      </form>
    </section>
  );
}
