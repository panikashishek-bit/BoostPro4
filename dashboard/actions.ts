"use server";

import { cookies } from "next/headers";
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
      // Только по https — но лишь на сервере. Локально пульт открывают по
      // http://<ip в сети>:3000, и secure там означал бы, что куку браузер
      // не отправит обратно и вход молча не сработает.
      secure: process.env.NODE_ENV === "production",
    });
  }

  // Неверный пароль не отличаем от верного ни ответом, ни задержкой:
  // страница просто перерисуется, и форма останется на месте.
  revalidatePath(DASHBOARD_PATH);
}

export async function logout() {
  (await cookies()).delete(COOKIE_NAME);
  revalidatePath(DASHBOARD_PATH);
}
