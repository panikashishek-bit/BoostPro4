// Точка входа бота-администратора.
// Бот отвечает клиентам по базе знаний из ../faq/ через модель на OpenRouter
// через инструменты ходит в API приложения (показать время, оформить запись)
// и понимает голосовые — их расшифровывает AssemblyAI.

import { Bot, type Context } from "grammy";
import { config } from "./config.js";
import { buildSystemPrompt } from "./prompt.js";
import { respond } from "./agent.js";
import { forget, getHistory, remember } from "./memory.js";
import { transcribe } from "./speech.js";
import { ServiceError } from "./retry.js";
import {
  beginTurn,
  close as closeSession,
  closeAll,
  initJournal,
  recordFailure,
  recordTurn,
  type Channel,
} from "./session.js";

const bot = new Bot(config.telegramBotToken);

// Инструкцию и базу знаний собираем один раз при старте: на каждое сообщение
// перечитывать файлы незачем, а ошибку в них увидим сразу, а не у первого клиента.
const systemPrompt = buildSystemPrompt();

const GREETING =
  "Здравствуйте! Я администратор салона «Лаванда».\n\n" +
  "Напишите, какая услуга вас интересует, — подскажу по цене и времени и подберу свободное окно.";

// Телефон салона продублирован здесь сознательно: он нужен как раз тогда, когда
// модель недоступна и разобрать базу знаний некому. Держать в паре с ../faq/salon.md.
const SALON_PHONE = "+7 (495) 000-00-00";

// Что говорим при сбое. Молчать нельзя: клиент решит, что его игнорируют.
// Технических подробностей здесь нет — они уходят в лог, клиенту нужен следующий шаг.
const failureReply = (reason: string) =>
  `${reason} Позвоните, пожалуйста, в салон: ${SALON_PHONE}, там подскажут. ` +
  "Или напишите мне через пару минут.";

// Telegram не принимает сообщения длиннее 4096 символов — обрезаем с запасом,
// иначе длинный ответ не дойдёт вообще и клиент останется вовсе без ответа.
const TELEGRAM_LIMIT = 3900;

// Слишком длинный текст незачем гнать в модель: это либо случайная вставка,
// либо попытка нагрузить бота. Обычный вопрос укладывается с большим запасом.
const MAX_QUESTION_LENGTH = 2000;

// Голосовое дольше трёх минут для записи на стрижку не нужно,
// а расшифровка такого файла стоит времени и денег.
const MAX_VOICE_SECONDS = 180;

// Логируем каждое входящее сообщение: на отладке видно, дошло ли оно вообще.
bot.use(async (ctx, next) => {
  const from = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "аноним";
  const text = ctx.message?.text ?? `<${ctx.message ? "не текст" : "не сообщение"}>`;
  console.log(`[входящее] ${from}: ${text}`);
  await next();
});

bot.command("start", async (ctx) => {
  // Клиент начал заново — прежнее обращение закрываем, иначе два разговора
  // склеятся в одну строку журнала.
  await closeSession(ctx.chat.id);
  forget(ctx.chat.id);
  await ctx.reply(GREETING);
});

/** Отвечает на вопрос клиента. Текст и расшифрованный голос идут здесь одной дорогой. */
async function answer(
  ctx: Context,
  chatId: number,
  question: string,
  channel: Channel
): Promise<void> {
  // Ответ модели занимает секунды — показываем «печатает», чтобы клиент не ушёл.
  await ctx.replyWithChatAction("typing");

  // Обращение заводим ДО ответа модели: даже если она сейчас упадёт,
  // владелец увидит в таблице, что клиент приходил.
  await beginTurn(chatId, channel);

  try {
    const { text, trace } = await respond(systemPrompt, getHistory(chatId), question);
    remember(chatId, { role: "user", content: question });
    remember(chatId, { role: "assistant", content: text });
    console.log(`[ответ] ${text.replace(/\n/g, " ").slice(0, 120)}…`);
    await ctx.reply(trim(text));
    await recordTurn(chatId, question, text, trace);
  } catch (error) {
    // Неудачный обмен в историю не пишем, иначе он будет мешать следующим ответам.
    console.error("[ошибка] запрос к модели не удался:", error);
    const reason =
      error instanceof ServiceError ? error.clientMessage : "Извините, сейчас не могу ответить.";
    await ctx.reply(failureReply(reason));
    await recordFailure(chatId, question);
  }
}

/** Режет ответ до предела Telegram по границе предложения, а не посреди слова. */
function trim(text: string): string {
  if (text.length <= TELEGRAM_LIMIT) return text;
  const cut = text.slice(0, TELEGRAM_LIMIT);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (lastStop > TELEGRAM_LIMIT / 2 ? cut.slice(0, lastStop + 1) : cut) + "…";
}

bot.on("message:text", async (ctx) => {
  const question = ctx.message.text.trim();
  if (!question) return;
  if (question.length > MAX_QUESTION_LENGTH) {
    await ctx.reply(
      "Сообщение слишком длинное, я такое не осилю. " +
        "Напишите, пожалуйста, покороче — какая услуга и на какой день."
    );
    return;
  }
  await answer(ctx, ctx.chat.id, question, "текст");
});

bot.on("message:voice", async (ctx) => {
  // Длинную запись отсекаем до скачивания: расшифровка стоит времени и денег,
  // а для записи на услугу трёх минут хватает с избытком.
  if (ctx.message.voice.duration > MAX_VOICE_SECONDS) {
    await ctx.reply(
      "Голосовое слишком длинное. Запишите, пожалуйста, покороче или напишите текстом."
    );
    return;
  }

  await ctx.replyWithChatAction("typing");

  let text: string;
  try {
    text = await transcribe(await downloadVoice(ctx));
  } catch (error) {
    console.error("[ошибка] расшифровка голосового не удалась:", error);
    await ctx.reply(
      "Извините, не получилось разобрать голосовое. Напишите, пожалуйста, текстом."
    );
    return;
  }

  if (!text) {
    await ctx.reply("Кажется, в записи не слышно речи. Попробуйте ещё раз или напишите текстом.");
    return;
  }

  console.log(`[голос] распознано: ${text}`);
  // Показываем, что расслышали: распознавание ошибается, и клиент должен заметить это сразу,
  // а не после того, как его запишут не на ту услугу.
  await ctx.reply(`🎧 Расслышала так: «${text}»`);

  await answer(ctx, ctx.chat.id, text, "голос");
});

// Остальные вложения — фото, видео, документы — бот не понимает.
bot.on("message", (ctx) =>
  ctx.reply("Пока я понимаю текст и голосовые. Напишите или наговорите, пожалуйста.")
);

/**
 * Скачивает голосовое сообщение.
 *
 * Файл забираем сами, а не отдаём AssemblyAI ссылку от Telegram: в этой ссылке
 * содержится токен бота, и передавать её стороннему сервису нельзя.
 */
async function downloadVoice(ctx: Context): Promise<Buffer> {
  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Telegram не отдал файл: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Последний рубеж: сюда попадает всё, что не поймали обработчики.
// Молча проглотить нельзя — клиент останется без ответа и решит, что его игнорируют.
bot.catch(async (err) => {
  console.error(`[ошибка] обновление ${err.ctx.update.update_id}:`, err.error);
  try {
    await err.ctx.reply(failureReply("Извините, что-то пошло не так."));
  } catch (replyError) {
    // Не смогли даже извиниться — значит недоступен сам Telegram. Просто пишем в лог.
    console.error("[ошибка] не удалось отправить сообщение о сбое:", replyError);
  }
});

// Корректная остановка: просим Telegram освободить опрос, прежде чем выйти.
// Без этого следующий запуск получает "Conflict: terminated by other getUpdates"
// и выглядит как «бот сломался», хотя сломан только порядок выключения.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`[стоп] получен ${signal}, останавливаю опрос`);
    await bot.stop();
    // Открытые обращения дописываем перед выходом, иначе они навсегда
    // останутся в таблице «в разговоре».
    await closeAll();
  });
}

// Доступ к таблице проверяем на старте: ошибку в ключе или в расшаривании
// лучше увидеть в логе сейчас, чем на первом клиенте.
await initJournal();

const me = await bot.api.getMe();
console.log(`[старт] бот @${me.username} на связи, модель ${config.model}`);

// Long polling: бот сам опрашивает Telegram по HTTP. Websocket не используем (правило 8).
await bot.start({ onStart: () => console.log("[старт] опрос Telegram запущен") });
