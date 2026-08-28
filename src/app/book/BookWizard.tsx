"use client";

import { useEffect, useRef, useState } from "react";
import { formatRub, formatDuration } from "@/lib/format";

type Service = {
  id: string;
  name: string;
  description: string | null;
  priceRub: number;
  durationMin: number;
};
type Master = { id: string; name: string; specialty: string | null };
type Slot = { startISO: string; label: string };

function dateInputValue(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function today(): string {
  return dateInputValue(new Date());
}

// Верхняя граница записи — 60 дней вперёд (не даём записаться на год вперёд).
function maxDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return dateInputValue(d);
}

// Шаг записи = реальная последовательность, поэтому номер несёт смысл.
function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
        {n}
      </span>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
    </div>
  );
}

const cardBase = "rounded-xl border p-4 text-left transition";
const cardSelected = "border-brand bg-brand text-white shadow-sm";
const cardIdle = "border-line bg-surface hover:border-brand/40";

const chipBase = "inline-flex min-h-11 items-center rounded-lg border text-sm transition";
const chipSelected = "border-brand bg-brand text-white";
const chipIdle = "border-line bg-surface hover:border-brand/40";

const inputClass =
  "mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand";

export default function BookWizard({
  initialServices,
  initialServiceId,
}: {
  initialServices: Service[];
  initialServiceId: string | null;
}) {
  const services = initialServices;

  const [masters, setMasters] = useState<Master[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);

  const [service, setService] = useState<Service | null>(
    () => initialServices.find((s) => s.id === initialServiceId) ?? null
  );
  const [master, setMaster] = useState<Master | null>(null);
  const [date, setDate] = useState<string>(today());
  const [slot, setSlot] = useState<Slot | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [comment, setComment] = useState("");

  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submitRef = useRef<HTMLDivElement>(null);

  // Мастера — при выборе услуги (в т.ч. при предвыборе из ?service=).
  useEffect(() => {
    if (!service) return;
    setMaster(null);
    setMasters([]);
    fetch(`/api/masters?serviceId=${service.id}`)
      .then((r) => r.json())
      .then(setMasters)
      .catch(() => setLoadError("Не удалось загрузить мастеров"));
  }, [service]);

  // Свободные слоты — при выборе мастера и даты.
  useEffect(() => {
    setSlot(null);
    setSlots([]);
    if (!service || !master || !date) return;
    setLoadingSlots(true);
    fetch(`/api/availability?masterId=${master.id}&serviceId=${service.id}&date=${date}`)
      .then((r) => r.json())
      .then(setSlots)
      .catch(() => setLoadError("Не удалось загрузить свободное время"))
      .finally(() => setLoadingSlots(false));
  }, [service, master, date]);

  async function submit() {
    if (!service || !master || !slot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          masterId: master.id,
          startISO: slot.startISO,
          clientName,
          clientPhone,
          comment,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Не удалось создать запись");
      }
      setDone(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Ошибка");
      // Прокрутить к ошибке у кнопки — пользователь стоит внизу формы.
      requestAnimationFrame(() =>
        submitRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done && service && master && slot) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-brand/30 bg-brand-soft p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-xl text-white">
          ✓
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">Вы записаны</h1>
        <p className="mt-3 text-ink">
          {service.name} · мастер {master.name}
        </p>
        <p className="text-muted">
          {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(
            new Date(slot.startISO)
          )}
        </p>
        <a
          href="/"
          className="mt-5 inline-block text-sm font-medium text-brand hover:text-brand-dark"
        >
          На главную
        </a>
      </div>
    );
  }

  const canSubmit =
    service && master && slot && clientName.trim() && clientPhone.trim() && !submitting;

  return (
    <div className="space-y-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Онлайн-запись
      </h1>

      {loadError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {loadError}
        </div>
      )}

      {/* Шаг 1: услуга */}
      <section className="space-y-3">
        <StepHeader n={1} title="Услуга" />
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => {
            const selected = service?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setService(s)}
                aria-pressed={selected}
                className={`${cardBase} ${selected ? cardSelected : cardIdle}`}
              >
                <div className="font-medium">{s.name}</div>
                <div className={`text-sm ${selected ? "text-white/80" : "text-muted"}`}>
                  {formatRub(s.priceRub)} · {formatDuration(s.durationMin)}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Шаг 2: мастер + дата + время */}
      {service && (
        <section className="space-y-4">
          <StepHeader n={2} title="Мастер и время" />
          <div className="flex flex-wrap gap-2">
            {masters.map((m) => {
              const selected = master?.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMaster(m)}
                  aria-pressed={selected}
                  className={`${chipBase} px-4 ${selected ? chipSelected : chipIdle}`}
                >
                  {m.name}
                  {m.specialty ? ` · ${m.specialty}` : ""}
                </button>
              );
            })}
            {masters.length === 0 && (
              <p className="text-sm text-muted">Нет доступных мастеров для этой услуги.</p>
            )}
          </div>

          {master && (
            <div className="space-y-3">
              <label className="block text-sm text-muted">
                Дата
                <input
                  type="date"
                  value={date}
                  min={today()}
                  max={maxDate()}
                  onChange={(e) => setDate(e.target.value)}
                  className={`${inputClass} sm:w-auto`}
                />
              </label>

              <div aria-live="polite">
                {loadingSlots ? (
                  <p className="text-sm text-muted">Загружаем свободное время…</p>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-muted">На эту дату нет свободных слотов.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {slots.map((s) => {
                      const selected = slot?.startISO === s.startISO;
                      return (
                        <button
                          key={s.startISO}
                          type="button"
                          onClick={() => setSlot(s)}
                          aria-pressed={selected}
                          className={`${chipBase} px-3 ${selected ? chipSelected : chipIdle}`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Шаг 3: контакты */}
      {service && master && slot && (
        <section className="space-y-4">
          <StepHeader n={3} title="Ваши контакты" />
          <div className="grid gap-3 sm:max-w-md">
            <label className="text-sm text-muted">
              Имя
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                autoComplete="name"
                placeholder="Как к вам обращаться"
                className={inputClass}
              />
            </label>
            <label className="text-sm text-muted">
              Телефон
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="+7 900 000-00-00"
                className={inputClass}
              />
            </label>
            <label className="text-sm text-muted">
              Комментарий <span className="text-muted/70">(необязательно)</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className={inputClass}
              />
            </label>
          </div>

          {/* Резюме перед подтверждением */}
          <div className="rounded-xl border border-line bg-brand-soft/40 px-4 py-3 text-sm text-ink">
            <span className="font-medium">{service.name}</span> · мастер {master.name} ·{" "}
            {new Intl.DateTimeFormat("ru-RU", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(slot.startISO))}{" "}
            · <span className="font-medium">{formatRub(service.priceRub)}</span>
          </div>

          <div ref={submitRef} className="space-y-2">
            {submitError && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {submitError}
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              aria-busy={submitting}
              className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Записываем…" : "Подтвердить запись"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
