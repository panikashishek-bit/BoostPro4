import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { HealthSource } from "./types";

const VARIABLE = "TRANSCRIPTS_DIR";

export const transcriptsSource: HealthSource = {
  id: "transcripts",
  title: "расшифровки",

  check(env) {
    const raw = env.get(VARIABLE);
    if (!raw) {
      return {
        state: "missing",
        detail: `переменная ${VARIABLE} не задана в dashboard/.env (готовые лежат в manager/transcribe/ready)`,
      };
    }

    const dir = resolve(process.cwd(), raw);

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return { state: "missing", detail: `${VARIABLE} указывает на ${dir}, но такой папки нет` };
    }

    if (!statSync(dir).isDirectory()) {
      return { state: "broken", detail: `${dir} — это файл, а ожидалась папка` };
    }

    const reports = entries.filter((name) => name.toLowerCase().endsWith(".md"));
    if (reports.length === 0) {
      return { state: "missing", detail: `папка ${dir} есть, но готовых расшифровок (.md) в ней пока нет` };
    }

    return { state: "ok", detail: `${dir} · ${reports.length} шт.` };
  },
};
