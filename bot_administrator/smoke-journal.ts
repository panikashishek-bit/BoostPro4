// Проверка журнала обращений без Telegram: три разговора — три строки в таблице «Клиенты».
// Запуск: npm run smoke:journal
//
// Идёт теми же модулями, что и бот: respond() + session.ts. Тратит запросы к модели
// и СОЗДАЁТ реальную запись в базе продукта — гонять по необходимости.

import { buildSystemPrompt } from "./src/prompt.js";
import { respond } from "./src/agent.js";
import { beginTurn, close, initJournal, recordTurn } from "./src/session.js";
import type { ChatMessage } from "./src/memory.js";

const prompt = buildSystemPrompt();

/** Один разговор целиком: свой chatId, своя строка в таблице. */
async function conversation(label: string, chatId: number, questions: string[]): Promise<void> {
  console.log(`\n════════ ${label} (чат ${chatId}) ════════`);
  const history: ChatMessage[] = [];

  for (const question of questions) {
    console.log(`КЛИЕНТ: ${question}`);
    await beginTurn(chatId, "текст");
    const { text, trace } = await respond(prompt, history, question);
    console.log(`БОТ: ${text}`);
    if (trace.length) console.log(`   ↳ инструменты: ${trace.map((t) => t.name).join(", ")}`);
    history.push({ role: "user", content: question }, { role: "assistant", content: text });
    await recordTurn(chatId, question, text, trace);
  }

  // Записавшегося session.ts закрывает сам; остальных закрываем как «замолчал».
  await close(chatId);
}

await initJournal();

const stamp = Date.now() % 100000;

await conversation("1. Спросил вне базы и ушёл — ждём J1", 900000 + stamp, [
  "Здравствуйте! А у вас есть подарочные сертификаты?",
]);

await conversation("2. Посмотрел время и ушёл — ждём J2", 910000 + stamp, [
  "Сколько стоит маникюр?",
  "Хочу записаться на маникюр в ближайшую среду, когда свободно?",
]);

await conversation("3. Записался — ждём J3", 920000 + stamp, [
  "Хочу на женскую стрижку в ближайший четверг, когда есть время?",
  "Давайте самое раннее. Меня зовут Полина, телефон +7 900 333-44-55",
  "Да, номер верный",
]);

console.log("\nГотово. Смотрите строки в таблице «Клиенты».");
