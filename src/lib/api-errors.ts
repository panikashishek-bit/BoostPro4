import { NextResponse } from "next/server";

/**
 * Обёртка для обработчиков API.
 *
 * Без неё падение внутри ручки (например, недоступная база) превращается в пустой 500
 * без тела: вызывающий видит «что-то сломалось», но не понимает, что именно и надолго ли.
 * С обёрткой наружу уходит honest JSON, а стек остаётся в логе сервера.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("[api] необработанная ошибка:", error);
      // 503, а не 500: база или сеть могут подняться, и повторить запрос имеет смысл.
      return NextResponse.json(
        { error: "Сервис временно недоступен, попробуйте позже" },
        { status: 503 }
      );
    }
  };
}
