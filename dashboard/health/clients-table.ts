import { readSheetKey, readRange } from "../sheets";
import { plural } from "../plural";
import type { HealthSource } from "./types";

const SHEET_VARIABLE = "CLIENTS_SHEET_ID";

// Таблица клиентов — та же Google-таблица, куда бот пишет журнал обращений:
// одна строка на обращение, шапку задаёт владелец.
//
// Пульт читает её сам, своим ключом и только на чтение. Свой id и свой ключ,
// а не подсмотренные у бота: папку dashboard/ должно быть можно унести целиком,
// и лазить в чужие настройки она не должна.
//
// Колонка «Начало» — это дата СОЗДАНИЯ строки (когда клиент написал), а не дата
// визита. Даты визита в таблице нет вообще, так что путать не с чем.

const CREATED_AT_COLUMN = "Начало";

export const clientsTableSource: HealthSource = {
  id: "clients-table",
  title: "таблица клиентов",

  async check(env) {
    const sheetId = env.get(SHEET_VARIABLE);
    if (!sheetId) {
      return { state: "missing", detail: `переменная ${SHEET_VARIABLE} не задана в dashboard/.env` };
    }

    const key = readSheetKey(env);
    if ("problem" in key) {
      return { state: "missing", detail: key.problem };
    }

    try {
      const values = await readRange(key.account, sheetId, "A1:Z2000");

      if (values.length === 0) {
        return { state: "broken", detail: "таблица открылась, но она пустая — нет даже шапки" };
      }

      const headers = values[0].map((cell) => String(cell).trim());
      const rows = values.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ""));

      if (rows.length === 0) {
        return { state: "ok", detail: "таблица на связи, обращений в ней пока нет" };
      }

      const at = headers.indexOf(CREATED_AT_COLUMN);
      if (at === -1) {
        return {
          state: "ok",
          detail: `таблица на связи: ${rows.length} ${plural(rows.length, "обращение", "обращения", "обращений")}; колонки «${CREATED_AT_COLUMN}» в шапке нет`,
        };
      }

      // Даты записаны как «ГГГГ-ММ-ДД ЧЧ:ММ:СС» — в этом виде они сравниваются как текст.
      const last = rows.reduce((newest, row) => {
        const value = String(row[at] ?? "").trim();
        return value > newest ? value : newest;
      }, "");

      return {
        state: "ok",
        detail: `таблица на связи: ${rows.length} ${plural(rows.length, "обращение", "обращения", "обращений")}, последнее ${last || "без даты"}`,
      };
    } catch (error) {
      // Google недоступен или ключ протух — это «настроено, но не читается»,
      // а не «не подключено»: разница видна по цвету строки.
      return { state: "broken", detail: (error as Error)?.message ?? "таблица не читается" };
    }
  },
};

