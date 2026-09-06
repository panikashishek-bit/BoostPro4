import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { readDashboardEnv, dashboardPassword, type DashboardEnv } from "./config";

// Вход в пульт по паролю из dashboard/.env.
//
// ⚠️ Это, как и пароль админки, учебный шлагбаум: один общий пароль, без учётных
// записей и без ограничения попыток. Он закрывает пульт от случайного прохожего,
// но не от того, кто задался целью. Пока за ним только счётчики — этого хватает;
// появятся имена и телефоны клиентов — понадобится настоящая авторизация.

const COOKIE = "dashboard_auth";

/** Восемь часов — рабочий день. Дольше держать открытым пульт незачем. */
export const COOKIE_MAX_AGE = 60 * 60 * 8;

/**
 * В куке лежит не пароль, а его отпечаток.
 *
 * Админка кладёт в куку сам пароль — так короче, но пароль после этого живёт
 * в браузере и уезжает на сервер с каждой картинкой и каждым запросом. Отпечаток
 * стоит одну строку кода и решает эту проблему: украденная кука по-прежнему
 * пускает внутрь, но сам пароль по ней не восстановить и в другом месте не применить.
 */
export function signature(password: string): string {
  return createHash("sha256").update(`dashboard:${password}`).digest("hex");
}

/** Сравнение за постоянное время: длина у отпечатков одинаковая, побайтовой утечки нет. */
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Совпадает ли введённый пароль с тем, что лежит в dashboard/.env. */
export function passwordMatches(env: DashboardEnv, submitted: string): boolean {
  const expected = dashboardPassword(env);
  // Пустой пароль в настройках — вход закрыт для всех, включая пустую форму.
  if (!expected) return false;
  return sameSignature(signature(submitted), signature(expected));
}

/**
 * Пущен ли посетитель. Настройки перечитываются здесь же, на каждом запросе:
 * сменил пароль в .env — старые куки перестают действовать сразу, без перезапуска.
 */
export async function isAuthed(): Promise<boolean> {
  const cookie = (await cookies()).get(COOKIE)?.value;
  if (!cookie) return false;

  const expected = dashboardPassword(readDashboardEnv());
  if (!expected) return false;

  return sameSignature(cookie, signature(expected));
}

/** Имя куки нужно и странице, и действиям входа/выхода — держим в одном месте. */
export const COOKIE_NAME = COOKIE;
