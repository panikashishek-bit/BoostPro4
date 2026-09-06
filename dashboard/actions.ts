"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { readDashboardEnv, dashboardPassword, DASHBOARD_PATH } from "./config";
import { passwordMatches, signature, COOKIE_NAME, COOKIE_MAX_AGE } from "./auth";

// Вход и выход. Отдельный файл с "use server", потому что в таком файле можно
// экспортировать только серверные действия — константам и обычным функциям
// место рядом, в auth.ts.

export async function login(formData: FormData) {
  const submitted = String(formData.get("password") ?? "");
  const env = readDashboardEnv();

  if (passwordMatches(env, submitted)) {
    (await cookies()).set(COOKIE_NAME, signature(dashboardPassword(env)), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      // Secure ставим по РЕАЛЬНОМУ протоколу соединения, а не по NODE_ENV.
      //
      // Браузер решает судьбу secure-куки по тому, как подключился он сам;
      // заголовки на это не влияют. Поставить secure на http-адресе — значит
      // молча выбросить куку: пароль верный, а вход не происходит, и выглядит
      // это как сломанный код. Решать по NODE_ENV — значит угадывать: на сервере
      // он всегда production, а вот https там может однажды и не оказаться.
      //
      // Локально (http по адресу в сети) заголовка нет — кука обычная, вход работает.
      secure: await isHttps(),
    });
  }

  // Неверный пароль не отличаем от верного ни ответом, ни задержкой:
  // страница просто перерисуется, и форма останется на месте.
  revalidatePath(DASHBOARD_PATH);
}

/**
 * Пришёл ли запрос по https. За прокси об этом говорит X-Forwarded-Proto:
 * сам Next видит только внутреннее http-соединение с nginx.
 *
 * Заголовок может нести список через запятую, если прокси несколько —
 * первый в списке и есть протокол, по которому подключался браузер.
 */
async function isHttps(): Promise<boolean> {
  const forwarded = (await headers()).get("x-forwarded-proto");
  return forwarded?.split(",")[0]?.trim().toLowerCase() === "https";
}

export async function logout() {
  (await cookies()).delete(COOKIE_NAME);
  revalidatePath(DASHBOARD_PATH);
}
