// Обращение к модели через OpenRouter.
// API совместимо с OpenAI, поэтому хватает обычного fetch — SDK не нужен.

import { config } from "./config.js";
import { isRetryableStatus, ServiceError, withRetry } from "./retry.js";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ReplyMessage = { content: string | null; tool_calls?: ToolCall[] };

type CompletionResponse = {
  choices?: { message?: ReplyMessage }[];
  error?: { message?: string };
};

/**
 * Один ход разговора с моделью. Возвращает её сообщение: либо текст для клиента,
 * либо запрос вызвать инструменты. Бросает исключение при любой проблеме.
 */
export function chat(messages: Message[], tools?: unknown[]): Promise<ReplyMessage> {
  return withRetry(() => askOnce(messages, tools), "OpenRouter");
}

async function askOnce(messages: Message[], tools?: unknown[]): Promise<ReplyMessage> {
  const response = await fetch(`${config.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
      // Низкая температура: администратору нужна точность по базе знаний, а не фантазия.
      temperature: 0.3,
    }),
    // Клиент ждёт ответа в чате — лучше признать сбой, чем висеть минуту.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const technical = `OpenRouter ответил ${response.status}: ${details.slice(0, 300)}`;
    // 429 — уперлись в лимит запросов. Это не поломка: подождать и повторить.
    const clientMessage =
      response.status === 429
        ? "Сейчас очень много обращений."
        : "Я временно не могу ответить.";
    throw new ServiceError(clientMessage, technical, isRetryableStatus(response.status));
  }

  const data = (await response.json()) as CompletionResponse;
  if (data.error) {
    throw new ServiceError(
      "Я временно не могу ответить.",
      `OpenRouter вернул ошибку: ${data.error.message}`,
      true
    );
  }

  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new ServiceError("Я временно не могу ответить.", "OpenRouter вернул пустой ответ", true);
  }

  return message;
}
