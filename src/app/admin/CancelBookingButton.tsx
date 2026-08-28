"use client";

import { useState } from "react";
import { cancelBooking } from "./actions";

// Инлайн-подтверждение деструктивного действия (без браузерного диалога):
// «Отменить» → «Точно? Да / Нет».
export default function CancelBookingButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="-mx-2 inline-flex min-h-11 items-center px-2 text-xs font-medium text-red-600 hover:underline"
      >
        Отменить
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-muted">Точно?</span>
      <form action={cancelBooking}>
        <input type="hidden" name="id" value={id} />
        <button className="-mx-1 inline-flex min-h-11 items-center px-1 text-xs font-semibold text-red-600 hover:underline">
          Да
        </button>
      </form>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="-mx-1 inline-flex min-h-11 items-center px-1 text-xs font-medium text-muted hover:text-ink"
      >
        Нет
      </button>
    </span>
  );
}
