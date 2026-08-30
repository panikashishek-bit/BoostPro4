// Быстрая проверка бота без Telegram: консультация по базе знаний и действие через API.
// Запуск: npm run smoke. Тратит запросы к модели и СОЗДАЁТ реальную запись — гонять по необходимости.

import { buildSystemPrompt } from "./src/prompt.js";
import { respond } from "./src/agent.js";
import type { ChatMessage } from "./src/memory.js";

const prompt = buildSystemPrompt();
const history: ChatMessage[] = [];

async function say(label: string, q: string) {
  console.log(`\n──────── ${label} ────────\nКЛИЕНТ: ${q}`);
  const { text, trace } = await respond(prompt, history, q);
  console.log(`БОТ: ${text}`);
  if (trace.length) console.log(`  (инструменты: ${trace.map((t) => t.name).join(", ")})`);
  history.push({ role: "user", content: q }, { role: "assistant", content: text });
  return text;
}

// (а) Консультация по базе знаний — API дёргать не должен
await say("A1. ФАКТ ИЗ БАЗЫ", "Сколько стоит маникюр и сколько по времени?");
await say("A2. ВНЕ БАЗЫ", "А у вас есть подарочные сертификаты?");

// (б) Действие через API
await say("B1. СВОБОДНОЕ ВРЕМЯ", "Хочу записаться на маникюр в ближайшую среду. Когда свободно?");
await say("B2. ЗАПИСЬ", "Давайте на 11:00. Меня зовут Ольга, телефон +7 900 111-22-33");
await say("B3. ПОВТОР НА ТО ЖЕ ВРЕМЯ", "Запишите ещё Ирину на маникюр в ту же среду на 11:00, телефон +7 900 444-55-66");
