import type { HealthSource } from "./types";

const VARIABLE = "CLIENTS_SHEET_ID";

// Таблица клиентов лежит в Google Sheets — той же, куда бот пишет журнал
// обращений (секрет SHEET_ID в деплое). Пульт сознательно просит СВОЙ id
// в своём .env: подключим — и он будет смотреть туда, куда сказали ему,
// а не туда, куда настроен кто-то другой.

export const clientsTableSource: HealthSource = {
  id: "clients-table",
  title: "таблица клиентов",

  check(env) {
    const sheetId = env.get(VARIABLE);
    if (!sheetId) {
      return { state: "missing", detail: `переменная ${VARIABLE} не задана в dashboard/.env` };
    }

    // Зелёной строка станет только когда пульт реально сходит в таблицу.
    // Пока читать её он не умеет — и врать зелёным не будет.
    return {
      state: "missing",
      detail: `${VARIABLE} задан, но ключ доступа к таблице пульт ещё не подключён — это следующий шаг`,
    };
  },
};
