// Разговор с клиентом: модель сама решает, ответить по базе знаний или вызвать инструмент.

import { chat, type Message } from "./llm.js";
import { runTool, toolDefinitions } from "./tools.js";
import type { ChatMessage } from "./memory.js";
import { ServiceError } from "./retry.js";

// Предохранитель от зацикливания: больше пары обращений к API за один ответ не нужно
// (посмотреть свободное время → записать), а бесконечный цикл сжёг бы лимит и деньги.
const MAX_TOOL_ROUNDS = 4;

/**
 * След одного вызова инструмента. Нужен журналу обращений: докуда клиент дошёл,
 * какая услуга и мастер обсуждались — всё это видно из вызовов, а не из текста ответа,
 * и разбирать реплики моделью ради этого незачем.
 */
export type ToolEvent = { name: string; args: Record<string, unknown>; result: unknown };

/** Ответ клиенту и то, что понадобилось сделать по дороге. */
export type Answer = { text: string; trace: ToolEvent[] };

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/**
 * Календарь на ближайшую неделю прямо в запросе.
 *
 * Считать «четверг» в число модель умеет через раз: на одной формулировке справляется,
 * на другой переспрашивает у клиента число. Готовая таблица снимает вопрос —
 * ей остаётся выбрать строку, а не вычислять.
 */
function todayLine(): string {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const days = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const name = i === 0 ? "сегодня" : i === 1 ? "завтра" : WEEKDAYS[d.getDay()]!;
    return `  ${iso(d)} — ${name}`;
  });

  return [
    `Сейчас ${iso(now)}, ${WEEKDAYS[now.getDay()]}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}.`,
    "Календарь на ближайшие дни — бери дату отсюда, у клиента число не переспрашивай:",
    ...days,
    "Клиент назвал день недели без числа — это ближайший такой день из таблицы.",
  ].join("\n");
}

/**
 * Грубое определение языка сообщения: считаем кириллицу против латиницы.
 *
 * Нужно потому, что одного правила в инструкции не хватило: вся инструкция и вся база
 * знаний на русском, и модель отвечала по-русски даже на английский вопрос.
 * Явное указание в каждом запросе работает надёжнее правила, которое можно проигнорировать.
 */
function languageLine(question: string): string {
  const cyrillic = (question.match(/[Ѐ-ӿ]/g) ?? []).length;
  const latin = (question.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic === 0 && latin === 0) return "";
  return cyrillic >= latin
    ? "Клиент написал по-русски. Отвечай по-русски."
    : "The client wrote in English. Reply in English — translate the facts from the Russian knowledge base.";
}

/** Ведёт один ход диалога: возвращает текст для клиента и след вызовов для журнала. */
export async function respond(
  systemPrompt: string,
  history: ChatMessage[],
  question: string
): Promise<Answer> {
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: todayLine() },
    ...(languageLine(question) ? [{ role: "system" as const, content: languageLine(question) }] : []),
    ...history,
    { role: "user", content: question },
  ];

  const trace: ToolEvent[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await chat(messages, toolDefinitions);

    if (!reply.tool_calls?.length) {
      const answer = reply.content?.trim();
      if (!answer) throw new Error("Модель вернула пустой ответ");
      return { text: answer, trace };
    }

    messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });

    for (const call of reply.tool_calls) {
      const { result, args } = await execute(call.function.name, call.function.arguments);
      trace.push({ name: call.function.name, args, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new Error(`Модель не уложилась в ${MAX_TOOL_ROUNDS} обращений к API`);
}

/**
 * Выполняет инструмент. Сбой не роняет разговор: текст ошибки уходит модели,
 * и она честно объясняет клиенту, что не получилось.
 */
async function execute(
  name: string,
  rawArgs: string
): Promise<{ result: unknown; args: Record<string, unknown> }> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return { result: { error: "Аргументы пришли не в формате JSON" }, args: {} };
  }

  console.log(`[инструмент] ${name} ${rawArgs}`);
  try {
    const result = await runTool(name, args);
    console.log(`[инструмент] ${name} → ${JSON.stringify(result).slice(0, 200)}`);
    return { result, args };
  } catch (error) {
    // В лог — все подробности, модели — только человеческая формулировка.
    // Сырой текст вроде «API /api/services ответил 500» модель может пересказать клиенту,
    // а тому нужно знать, что делать, а не что сломалось.
    const technical = error instanceof Error ? error.message : String(error);
    console.error(`[инструмент] ${name} упал: ${technical}`);

    const clientMessage =
      error instanceof ServiceError
        ? error.clientMessage
        : "Расписание сейчас недоступно.";

    return {
      result: {
        ok: false,
        error: clientMessage,
        instruction:
          "Извинись перед клиентом своими словами, предложи позвонить в салон и попробовать позже. " +
          "Не упоминай технических подробностей, кодов ошибок и названий систем.",
      },
      args,
    };
  }
}
