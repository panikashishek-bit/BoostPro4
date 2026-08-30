import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Чтение и проверка переменных окружения.
// Значения приходят из ./.env — Node подставляет их сам через --env-file (см. package.json).
// Все секреты бота живут здесь: Telegram, OpenRouter, API приложения, AssemblyAI.

/** Читает обязательную переменную. Падает сразу со внятным текстом, а не позже и невнятно. */
const BOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Читает необязательную переменную. Пустая и незаданная — одно и то же. */
function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Не задана переменная ${name}. Впишите значение в bot_administrator/.env ` +
        `(имя переменной продублировано в .env.example).`
    );
  }
  return value;
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  openRouterApiKey: required("OPENROUTER_API_KEY"),
  appApiKey: required("APP_API_KEY"),
  appApiUrl: required("APP_API_URL").replace(/\/+$/, ""),
  assemblyAiApiKey: required("ASSEMBLYAI_API_KEY"),

  /**
   * Ключ служебного аккаунта для журнала обращений — двумя способами.
   *
   * Локально удобнее файлом: GOOGLE_SA_KEY_PATH, путь разрешается от папки бота
   * («../.secrets/google-bot.json»). В контейнере — переменной GOOGLE_SA_KEY с тем же
   * JSON в одну строку: пробрасывать файл внутрь оказалось ненадёжно, а ключ в переменной
   * не зависит ни от путей, ни от того, как хост понимает монтирование.
   *
   * Задан хотя бы один — журнал работает. Не задан ни один — бот работает без журнала:
   * ронять из-за этого разговоры с клиентами незачем.
   */
  googleSaKey: optional("GOOGLE_SA_KEY"),
  googleSaKeyPath: optional("GOOGLE_SA_KEY_PATH")
    ? resolve(BOT_DIR, optional("GOOGLE_SA_KEY_PATH")!)
    : undefined,
  sheetId: optional("SHEET_ID"),

  /** Адрес OpenRouter: API совместим с OpenAI, поэтому годится обычный chat/completions. */
  openRouterBaseUrl: "https://openrouter.ai/api/v1",

  /** Модель зафиксирована сознательно — менять только осознанно. */
  model: "google/gemini-2.5-flash",

  /** Модель распознавания речи: universal-2 понимает русский. */
  speechModel: "universal-2",

  /** Сколько последних сообщений чата уходит модели: 5 пар «вопрос — ответ». */
  historyLimit: 10,
} as const;
