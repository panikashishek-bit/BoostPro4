import { prisma } from "@/lib/prisma";
import { addMaster, updateMaster, toggleMaster, setMasterServices } from "./actions";

const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand";
const saveBtn =
  "inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-xs font-medium text-ink transition hover:border-brand/50 hover:bg-brand-soft hover:text-brand";

export default async function TeamTab() {
  const [masters, services] = await Promise.all([
    prisma.master.findMany({ orderBy: { name: "asc" }, include: { services: true } }),
    prisma.service.findMany({ orderBy: { name: "asc" } }),
  ]);
  const activeServices = services.filter((s) => s.isActive);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "—";

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">Команда</h2>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {masters.map((m) => {
          const assigned = new Set(m.services.map((ms) => ms.serviceId));
          return (
            <li key={m.id} className="space-y-2 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className={m.isActive ? "" : "text-muted"}>
                  <div className="font-medium text-ink">
                    {m.name}
                    {m.isActive ? "" : " (скрыт)"}
                  </div>
                  {m.specialty && <div className="text-xs text-muted">{m.specialty}</div>}
                </div>
                <form action={toggleMaster}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="-mx-2 inline-flex min-h-11 items-center whitespace-nowrap px-2 text-xs font-medium text-muted transition hover:text-ink">
                    {m.isActive ? "Скрыть" : "Включить"}
                  </button>
                </form>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Редактировать</summary>
                <form action={updateMaster} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={m.id} />
                  <label className="text-xs text-muted">
                    Имя
                    <input name="name" defaultValue={m.name} required className={`mt-1 block ${inputClass}`} />
                  </label>
                  <label className="text-xs text-muted">
                    Специализация
                    <input
                      name="specialty"
                      defaultValue={m.specialty ?? ""}
                      className={`mt-1 block ${inputClass}`}
                    />
                  </label>
                  <button className={saveBtn}>Сохранить</button>
                </form>
              </details>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  Услуги:{" "}
                  {assigned.size === 0 ? "не назначены" : [...assigned].map(serviceName).join(", ")}
                </summary>
                <form action={setMasterServices} className="mt-2 space-y-2">
                  <input type="hidden" name="masterId" value={m.id} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {services.map((s) => (
                      <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          name="serviceIds"
                          value={s.id}
                          defaultChecked={assigned.has(s.id)}
                          className="h-5 w-5 accent-brand"
                        />
                        <span className={s.isActive ? "text-ink" : "text-muted"}>
                          {s.name}
                          {s.isActive ? "" : " (скрыта)"}
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

      {/* Добавление мастера */}
      <form action={addMaster} className="space-y-3 rounded-2xl border border-dashed border-line p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Имя
            <input name="name" required className={`mt-1 block ${inputClass}`} />
          </label>
          <label className="text-xs text-muted">
            Специализация
            <input name="specialty" className={`mt-1 block ${inputClass}`} />
          </label>
        </div>

        {activeServices.length > 0 && (
          <fieldset className="text-xs text-muted">
            <legend className="mb-1.5">Какие услуги делает</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {activeServices.map((s) => (
                <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="serviceIds" value={s.id} className="h-5 w-5 accent-brand" />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <button className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">
          Добавить мастера
        </button>
      </form>
    </section>
  );
}
