import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { HealthSource } from "./types";

const VARIABLE = "EVENTS_DB_PATH";

export const eventsLogSource: HealthSource = {
  id: "events-log",
  title: "лог событий",

  check(env) {
    const raw = env.get(VARIABLE);
    if (!raw) {
      return { state: "missing", detail: `переменная ${VARIABLE} не задана в dashboard/.env` };
    }

    // Относительный путь считаем от корня проекта, а не от текущей папки:
    // иначе значение вело бы в разные места в dev и в контейнере.
    const path = resolve(process.cwd(), raw);
    if (!existsSync(path)) {
      return { state: "missing", detail: `${VARIABLE} указывает на ${path}, но такого файла нет` };
    }

    const size = statSync(path).size;
    return { state: "ok", detail: `${path} · ${Math.max(1, Math.round(size / 1024))} КБ` };
  },
};
