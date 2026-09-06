import type { DashboardEnv } from "../config";
import type { HealthSource, HealthReport } from "./types";
import { dashboardEnvSource } from "./dashboard-env";
import { eventsLogSource } from "./events-log";
import { clientsTableSource } from "./clients-table";
import { transcriptsSource } from "./transcripts";
import { sessionTimeoutSource } from "./session-timeout";

// Список источников для блока «Проверка связи».
//
// ЕДИНСТВЕННОЕ место, которое правится при добавлении источника: новый файл рядом
// и одна строка здесь. Порядок в списке — порядок строк на странице.

export const SOURCES: HealthSource[] = [
  dashboardEnvSource,
  eventsLogSource,
  sessionTimeoutSource,
  clientsTableSource,
  transcriptsSource,
];

export type CheckedSource = { source: HealthSource; report: HealthReport };

/**
 * Прогоняет все проверки. Каждая — в своём try: упавший источник становится
 * обычной строкой «сломан», а остальные строки и вся страница продолжают жить.
 * Пульт, падающий целиком из-за одного счётчика, бесполезен ровно тогда,
 * когда он нужнее всего.
 */
export async function runHealthChecks(env: DashboardEnv): Promise<CheckedSource[]> {
  return Promise.all(
    SOURCES.map(async (source) => {
      try {
        return { source, report: await source.check(env) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          source,
          report: { state: "broken", detail: `проверка сорвалась: ${reason}` } as HealthReport,
        };
      }
    })
  );
}
