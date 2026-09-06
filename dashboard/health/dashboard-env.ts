import { dashboardPassword } from "../config";
import type { HealthSource } from "./types";

// Проверка самого файла настроек — первая строка в списке.
//
// Она отвечает на вопрос, который иначе стоил бы часа догадок: «.env доехал
// на сервер или нет?». Деплой возит код и не возит секреты, так что файл
// кладётся отдельно и ровно поэтому чаще всего и отсутствует.

export const dashboardEnvSource: HealthSource = {
  id: "dashboard-env",
  title: "настройки пульта (dashboard/.env)",

  check(env) {
    if (!env.found) {
      return { state: "missing", detail: `${env.problem}; ждём его по пути ${env.path}` };
    }

    if (!dashboardPassword(env)) {
      return {
        state: "broken",
        detail: "файл на месте, но DASHBOARD_PASSWORD в нём пуст — войти не сможет никто",
      };
    }

    return { state: "ok", detail: `прочитан: ${env.path}` };
  },
};
