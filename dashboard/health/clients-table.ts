import { readClientsTable } from "../sheets";
import { plural } from "../plural";
import type { HealthSource } from "./types";

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

/** Колонку заводит npm run demo:seed. Её нет — значит и учебных строк нет. */
const DEMO_COLUMN = "Демо";
const DEMO_VALUE = "да";

export const clientsTableSource: HealthSource = {
  id: "clients-table",
  title: "таблица клиентов",

  async check(env) {
    // Читать таблицу умеет один помощник на весь пульт: и эта строка, и счётчик
    // «Сверка» ходят в неё одинаково, и тексты «не прочитал» у них общие.
    const table = await readClientsTable(env, "A1:Z2000");

    if ("problem" in table) {
      // Не задан id или ключ — это «не подключено», а не поломка: пульт просто
      // ещё не познакомили с таблицей. Всё остальное — «настроено и не читается».
      const notConnected = table.problem.includes("не задана") || table.problem.includes("ключ");
      return { state: notConnected ? "missing" : "broken", detail: table.problem };
    }

    const { headers, rows } = table;

    if (rows.length === 0) {
      return { state: "ok", detail: "таблица на связи, обращений в ней пока нет" };
    }

    // Учебные строки называем вслух: без этого «205 обращений» выглядит
    // как двести настоящих клиентов, которых на самом деле девять.
    const demoAt = table.at(DEMO_COLUMN);
    const demo =
      demoAt === -1
        ? 0
        : rows.filter((row) => String(row[demoAt] ?? "").trim().toLowerCase() === DEMO_VALUE).length;
    const drawn = demo > 0 ? `, из них ${demo} учебных (npm run demo:wipe сотрёт)` : "";

    const at = headers.indexOf(CREATED_AT_COLUMN);
    if (at === -1) {
      return {
        state: "ok",
        detail: `таблица на связи: ${rows.length} ${plural(rows.length, "обращение", "обращения", "обращений")}${drawn}; колонки «${CREATED_AT_COLUMN}» в шапке нет`,
      };
    }

    // Даты записаны как «ГГГГ-ММ-ДД ЧЧ:ММ:СС» — в этом виде они сравниваются как текст.
    const last = rows.reduce((newest, row) => {
      const value = String(row[at] ?? "").trim();
      return value > newest ? value : newest;
    }, "");

    return {
      state: "ok",
      detail: `таблица на связи: ${rows.length} ${plural(rows.length, "обращение", "обращения", "обращений")}${drawn}, последнее ${last || "без даты"}`,
    };
  },
};

