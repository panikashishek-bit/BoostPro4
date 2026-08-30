// HTTP-клиент API приложения.
// Адрес и ключ берутся из .env — localhost в коде нет: при переезде на сервер
// меняется одна переменная APP_API_URL.

import { config } from "./config.js";
import { isRetryableStatus, ServiceError, withRetry } from "./retry.js";

export type Service = { id: string; name: string; priceRub: number; durationMin: number };
export type Master = { id: string; name: string; specialty: string | null };
export type Slot = { startISO: string; label: string };

/** Ошибка API со статусом — 409 «время заняли» надо отличать от настоящей поломки. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function once<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.appApiUrl}${path}`, {
    ...init,
    headers: {
      "x-api-key": config.appApiKey,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const technical = `API ${path} ответил ${response.status}: ${body.slice(0, 200)}`;

    // 409 — рабочий случай «время заняли», его разбирает вызывающий код.
    if (response.status === 409) throw new ApiError(409, technical);

    if (isRetryableStatus(response.status)) {
      throw new ServiceError("Расписание сейчас недоступно.", technical, true);
    }
    throw new ServiceError("Расписание сейчас недоступно.", technical, false);
  }

  return (await response.json()) as T;
}

/** Запрос с повтором при временных сбоях. Ошибки клиента (409) повторять не пытаемся. */
function call<T>(path: string, init?: RequestInit): Promise<T> {
  return withRetry(() => once<T>(path, init), `API ${path}`);
}

export const api = {
  services: () => call<Service[]>("/api/services"),

  /** Мастера, делающие услугу. */
  masters: (serviceId: string) =>
    call<Master[]>(`/api/masters?serviceId=${encodeURIComponent(serviceId)}`),

  /** Свободные слоты мастера на дату под конкретную услугу. */
  availability: (masterId: string, serviceId: string, date: string) =>
    call<Slot[]>(
      `/api/availability?masterId=${encodeURIComponent(masterId)}` +
        `&serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`
    ),

  createBooking: (body: {
    serviceId: string;
    masterId: string;
    startISO: string;
    clientName: string;
    clientPhone: string;
    comment?: string;
  }) => call<{ id: string }>("/api/bookings", { method: "POST", body: JSON.stringify(body) }),
};

/** Ошибка API со статусом — чтобы отличить «время заняли» (409) от настоящей поломки. */
export function statusOf(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined;
}
