import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Чтение и проверка переменных окружения.
// Значения приходят из ./.env — Node подставляет их сам через --env-file (см. package.json).
// Все секреты бота живут здесь: Telegram, OpenRouter, API приложения, AssemblyAI.

/** Читает обязательную переменную. Падает сразу со внятным текстом, а не позже и невнятно. */
const BOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
   * Журнал обращений в Google-таблице. Путь к ключу разрешаем от папки бота:
   * в .env удобно писать «../.secrets/google-bot.json», а на сервере — абсолютный.
   */
  googleSaKeyPath: resolve(BOT_DIR, required("GOOGLE_SA_KEY_PATH")),
  sheetId: required("SHEET_ID"),

  /** Адрес OpenRouter: API совместим с OpenAI, поэтому годится обычный chat/completions. */
  openRouterBaseUrl: "https://openrouter.ai/api/v1",

  /** Модель зафиксирована сознательно — менять только осознанно. */
  model: "google/gemini-2.5-flash",

  /** Модель распознавания речи: universal-2 понимает русский. */
  speechModel: "universal-2",

  /** Сколько последних сообщений чата уходит модели: 5 пар «вопрос — ответ». */
  historyLimit: 10,
} as const;
