import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import CancelBookingButton from "./CancelBookingButton";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CONFIRMED: { label: "Подтверждена", cls: "bg-brand-soft text-brand" },
    CANCELLED: { label: "Отменена", cls: "bg-gray-100 text-gray-500" },
    DONE: { label: "Завершена", cls: "bg-blue-50 text-blue-600" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

export default async function BookingsTab() {
  const bookings = await prisma.booking.findMany({
    where: { startAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    orderBy: { startAt: "asc" },
    include: { service: true, master: true },
  });

  if (bookings.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Ближайшие записи</h2>
        <p className="text-sm text-muted">Записей пока нет.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Ближайшие записи</h2>

      {/* Мобайл: карточки (без горизонтального скролла) */}
      <ul className="space-y-2 sm:hidden">
        {bookings.map((b) => (
          <li
            key={b.id}
            className={`rounded-xl border border-line bg-surface p-4 ${
              b.status === "CANCELLED" ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-ink">{b.service.name}</div>
                <div className="text-sm text-muted">
                  {formatDateTime(b.startAt)} · {b.master.name}
                </div>
                <div className="mt-1 text-sm text-ink">{b.clientName}</div>
                <div className="text-xs text-muted">{b.clientPhone}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge status={b.status} />
                {b.status !== "CANCELLED" && <CancelBookingButton id={b.id} />}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Десктоп: таблица */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface sm:block">
        <table className="w-full text-sm">
          <thead className="bg-bg text-left text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Когда</th>
              <th className="px-4 py-2.5 font-medium">Услуга</th>
              <th className="px-4 py-2.5 font-medium">Мастер</th>
              <th className="px-4 py-2.5 font-medium">Клиент</th>
              <th className="px-4 py-2.5 font-medium">Статус</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {bookings.map((b) => (
              <tr key={b.id} className={b.status === "CANCELLED" ? "text-muted" : "text-ink"}>
                <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(b.startAt)}</td>
                <td className="px-4 py-2.5">{b.service.name}</td>
                <td className="px-4 py-2.5">{b.master.name}</td>
                <td className="px-4 py-2.5">
                  {b.clientName}
                  <div className="text-xs text-muted">{b.clientPhone}</div>
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={b.status} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {b.status !== "CANCELLED" && <CancelBookingButton id={b.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
