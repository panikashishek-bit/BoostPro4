// База знаний администратора: файлы из ../faq/.
// Это единственные факты, на которые боту разрешено опираться в ответах клиенту.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const FAQ_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "faq");

// README — это инструкция для нас (правила безопасности, что заменить перед запуском),
// а не факты для клиента. Модели её не даём.
const SKIP = new Set(["README.md"]);

/** Читает базу знаний один раз при старте и склеивает в один текст с заголовками файлов. */
export function loadKnowledgeBase(): string {
  const files = readdirSync(FAQ_DIR)
    .filter((name) => name.endsWith(".md") && !SKIP.has(name))
    .sort();

  if (files.length === 0) {
    throw new Error(`База знаний пуста: в ${FAQ_DIR} нет ни одного .md-файла.`);
  }

  return files
    .map((name) => `### Файл: ${name}\n\n${readFileSync(join(FAQ_DIR, name), "utf8").trim()}`)
    .join("\n\n---\n\n");
}
