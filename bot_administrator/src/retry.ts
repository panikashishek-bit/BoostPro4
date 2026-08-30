// Повтор запроса при временных сбоях.
//
// Сеть моргает, внешние сервисы отвечают 429 и 5xx — это не поломка, а обычный шум.
// Один повтор через паузу спасает большинство таких случаев, и клиент ничего не замечает.
// Повторять ошибки клиента (400, 401, 404, 409) бессмысленно: второй раз ответят так же.

/** Ошибка внешнего сервиса с понятным для клиента объяснением. */
export class ServiceError extends Error {
  constructor(
    /** Что сказать клиенту — без технических подробностей. */
    readonly clientMessage: string,
    /** Что записать в лог — со всеми подробностями. */
    technical: string,
    readonly retryable: boolean
  ) {
    super(technical);
    this.name = "ServiceError";
  }
}

/** Стоит ли пробовать ещё раз: временные сбои — да, ошибки в запросе — нет. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Выполняет операцию, повторяя её при временных сбоях.
 * Пауза растёт: 0.5 с, 1.5 с — суммарно две секунды, клиент этого не замечает.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T> {
  const delays = [500, 1500];
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ServiceError ? error.retryable : isNetworkError(error);
      const lastAttempt = attempt === attempts - 1;
      if (!retryable || lastAttempt) break;

      const delay = delays[attempt] ?? 1500;
      console.warn(`[повтор] ${label}: попытка ${attempt + 1} не удалась, жду ${delay} мс`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/** Обрыв связи или таймаут — сервис не ответил, стоит попробовать снова. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    error.message.includes("fetch failed") ||
    error.message.includes("ECONNREFUSED") ||
    error.message.includes("ECONNRESET") ||
    error.message.includes("ETIMEDOUT")
  );
}
