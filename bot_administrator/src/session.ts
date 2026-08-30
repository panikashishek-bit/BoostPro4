// Обращение клиента: одна строка в таблице «Клиенты» на один разговор.
//
// Единица учёта — обращение, а не сообщение (см. ../client_log.md). Строка появляется
// сразу, как клиент написал, и дописывается по ходу разговора: незавершённые обращения —
// то, ради чего таблица и заводилась, и терять их при падении бота нельзя.
//
// Что можно узнать из кода — узнаём из кода: услуга, мастер, телефон и то, докуда клиент
// дошёл, берутся из вызовов инструментов, а не из догадок модели. Модель зовём один раз,
// на закрытии обращения, и только за тем, чего в вызовах нет: с чем клиент приходил
// и почему разговор оборвался.

import { chat } from "./llm.js";
import { appendRow, connect, updateRow, type Row } from "./sheet.js";
import type { ToolEvent } from "./agent.js";

/** Через сколько молчания обращение считается законченным. */
const IDLE_MS = 30 * 60 * 1000;

/** Сколько последних реплик храним для разбора. Больше модели и не нужно. */
const TURNS_KEPT = 20;

export type Channel = "текст" | "голос";

type Turn = { question: string; reply: string };

type Session = {
  id: string;
  chatId: number;
  startedAt: number;
  channel: Channel;
  messages: number;
  turns: Turn[];
  name?: string;
  phone?: string;
  service?: string;
  master?: string;
  /** Докуда дошёл клиент: J1 спросил · J2 увидел время · J3 записался. */
  reached: "J1" | "J2" | "J3";
  bookingId?: string;
  /** Метка запроса от модели: точнее грубой эвристики, но появляется только при закрытии. */
  intentLabel?: string;
  breakReason?: string;
  unanswered?: string;
  /** Разговор упёрся в сбой, а не в решение клиента. */
  failed: boolean;
  row: number | null;
  /** Очередь записей в таблицу: две строки на один разговор появиться не должны. */
  writing?: Promise<void>;
  idle?: NodeJS.Timeout;
};

const open = new Map<number, Session>();
let ready = false;

/** Проверяет доступ к таблице при старте. Нет доступа — бот работает как раньше, без журнала. */
export async function initJournal(): Promise<void> {
  ready = await connect();
  if (!ready) console.warn("[журнал] обращения писаться не будут — бот продолжает работать");
}

function create(chatId: number, channel: Channel): Session {
  const startedAt = Date.now();
  return {
    id: `${chatId}-${startedAt}`,
    chatId,
    startedAt,
    channel,
    messages: 0,
    turns: [],
    reached: "J1",
    failed: false,
    row: null,
  };
}

/** Строка таблицы из текущего состояния обращения. */
function toRow(session: Session, finished: boolean): Row {
  const endedAt = finished ? Date.now() : undefined;
  return {
    id: session.id,
    startedAt: moment(session.startedAt),
    endedAt: endedAt ? moment(endedAt) : "",
    chatId: session.chatId,
    phone: session.phone ?? "",
    channel: session.channel,
    intent: session.turns.length ? intentOf(session) : "",
    service: session.service ?? "",
    master: session.master ?? "",
    reached: session.reached,
    outcome: outcomeOf(session, finished),
    breakReason: finished ? session.breakReason ?? "" : "",
    bookingId: session.bookingId ?? "",
    unanswered: session.unanswered ?? "",
    messages: session.messages,
    durationSec: Math.round(((endedAt ?? Date.now()) - session.startedAt) / 1000),
    name: session.name ?? "",
  };
}

/**
 * Состояние обращения. Пока разговор идёт — «в разговоре»: без этого значения
 * строка, появившаяся сразу, выглядела бы как уже закончившаяся ничем.
 */
function outcomeOf(session: Session, finished: boolean): string {
  if (session.reached === "J3") return "записался";
  if (!finished) return "в разговоре";
  return session.failed ? "бот не смог" : "ушёл";
}

/** Метка запроса: от модели, если она уже разобрала обращение, иначе — грубая, по коду. */
function intentOf(session: Session): string {
  if (session.intentLabel) return session.intentLabel;
  if (session.reached !== "J1") return "запись";
  const asked = session.turns.map((turn) => turn.question).join(" ").toLowerCase();
  if (/отмен|перенес|перенёс|перенос/.test(asked)) return "отмена/перенос";
  return "вопрос";
}

/** Дата в виде, который Google Sheets понимает как дату, а человек читает без расшифровки. */
function moment(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Записывает состояние обращения в таблицу: первый раз — новой строкой, дальше — поверх.
 *
 * Записи выстраиваем в очередь на обращение. Без неё два сообщения подряд из одного чата
 * успевают начать запись одновременно, пока номер строки ещё не известен, — и в таблице
 * появляются две строки на один разговор.
 */
function flush(session: Session, finished: boolean): Promise<void> {
  if (!ready) return Promise.resolve();
  session.writing = (session.writing ?? Promise.resolve()).then(async () => {
    const row = toRow(session, finished);
    session.row =
      session.row === null ? await appendRow(row) : await updateRow(session.row, session.id, row);
  });
  return session.writing;
}

/** Начинает обращение или продлевает текущее. Вызывается на каждое сообщение клиента. */
export async function beginTurn(chatId: number, channel: Channel): Promise<void> {
  let session = open.get(chatId);

  if (!session) {
    session = create(chatId, channel);
    open.set(chatId, session);
    // Строку заводим сразу: если бот упадёт посреди разговора, обращение всё равно видно.
    await flush(session, false);
  }

  session.messages += 1;
  clearTimeout(session.idle);
  session.idle = setTimeout(() => void close(chatId), IDLE_MS);
  // Таймер не должен держать процесс живым, когда бот уже останавливают.
  session.idle.unref?.();
}

/** Дополняет обращение результатом хода: что вызвали, что ответили клиенту. */
export async function recordTurn(
  chatId: number,
  question: string,
  reply: string,
  trace: ToolEvent[]
): Promise<void> {
  const session = open.get(chatId);
  if (!session) return;

  session.turns = [...session.turns, { question, reply }].slice(-TURNS_KEPT);
  applyTrace(session, trace);
  detectUnanswered(session, question, reply);

  // Записался — обращение закрыто: клиент получил то, за чем приходил.
  if (session.reached === "J3") await close(chatId);
  else await flush(session, false);
}

/** Отмечает, что ход не удался из-за сбоя, а не из-за клиента. */
export async function recordFailure(chatId: number, question: string): Promise<void> {
  const session = open.get(chatId);
  if (!session) return;
  session.failed = true;
  session.breakReason = "ошибка API";
  session.turns = [...session.turns, { question, reply: "" }].slice(-TURNS_KEPT);
  await flush(session, false);
}

/** Достаёт из вызовов инструментов то, что известно точно. */
function applyTrace(session: Session, trace: ToolEvent[]): void {
  for (const event of trace) {
    const args = event.args as Record<string, string>;
    const result = event.result as Record<string, unknown>;

    if (args.service) session.service = args.service;
    if (args.master) session.master = args.master;
    if (args.clientName) session.name = args.clientName;

    if (event.name === "find_free_slots") {
      if (session.reached === "J1") session.reached = "J2";
      // Пустой список — самая частая причина уйти: времени нет, а не передумал.
      if (Array.isArray(result?.free) && result.free.length === 0) {
        session.breakReason = "нет удобного времени";
      }
    }

    if (event.name === "create_booking") {
      const booked = result?.booked as Record<string, string> | undefined;
      if (result?.ok === true && booked) {
        session.reached = "J3";
        session.service = booked.service ?? session.service;
        session.master = booked.master ?? session.master;
        session.phone = booked.phone ?? session.phone;
        session.bookingId = booked.bookingId ?? "";
        session.breakReason = undefined;
      }
      // Нормализованный телефон известен ещё до подтверждения — он уже проверен кодом.
      if (typeof result?.normalizedPhone === "string") session.phone = result.normalizedPhone;
    }

    // Инструмент вернул человеческую причину отказа — она точнее любой догадки.
    if (result?.ok === false && typeof result.error === "string") {
      session.breakReason = /мастер/i.test(result.error) ? "нет нужного мастера" : "ошибка API";
      session.failed = true;
    }
  }
}

/**
 * Ловит «не знаю» по формулировке из character.md.
 *
 * База знаний вклеена в системную инструкцию, отдельного вызова у неё нет — по логу
 * инструментов такой случай не виден. Поиск по фразе бесплатен и не ошибается там,
 * где сработал; чего он не поймал, подберёт разбор при закрытии.
 */
function detectUnanswered(session: Session, question: string, reply: string): void {
  const admits = /не подскажу|не могу подсказать|не знаю|уточните.{0,20}по телефону/i.test(reply);
  if (admits && !session.unanswered) {
    session.unanswered = question;
    session.breakReason ??= "бот не знал ответа";
  }
}

/** Закрывает обращение: уточняет метки у модели и дописывает итог в таблицу. */
export async function close(chatId: number): Promise<void> {
  const session = open.get(chatId);
  if (!session) return;

  clearTimeout(session.idle);
  open.delete(chatId);

  if (session.turns.length > 0) await classify(session);
  await flush(session, true);
  console.log(
    `[журнал] обращение ${session.id}: ${outcomeOf(session, true)}, дошёл до ${session.reached}` +
      (session.breakReason ? `, причина: ${session.breakReason}` : "")
  );
}

/** Закрывает все открытые обращения — при остановке бота. */
export async function closeAll(): Promise<void> {
  await Promise.all([...open.keys()].map((chatId) => close(chatId)));
}

const INTENTS = ["вопрос", "запись", "отмена/перенос", "прочее"];

/**
 * Причины обрыва делятся по тому, кто их вообще может знать.
 *
 * «Нет удобного времени», «нет нужного мастера» и «ошибка API» видны только из ответа
 * инструмента — их ставит код. Модели их не предлагаем: она читает лишь текст разговора
 * и назовёт такую причину наугад. Так и вышло на проверке — клиенту ответили,
 * что услуги нет, а разбор пометил обращение как «нет нужного мастера».
 */
const REASONS_FROM_DIALOG = [
  "бот не знал ответа",
  "спросил про отмену/перенос",
  "спросил про оплату",
  "ушёл молча",
  "другое",
];

/**
 * Один дешёвый вызов модели на всё обращение — за тем, чего нет в вызовах инструментов.
 * Не удался — остаются метки, посчитанные кодом: журнал не должен зависеть от модели.
 */
async function classify(session: Session): Promise<void> {
  const dialog = session.turns
    .map((turn) => `Клиент: ${turn.question}\nАдминистратор: ${turn.reply || "(сбой)"}`)
    .join("\n");

  try {
    const reply = await chat([
      {
        role: "system",
        content: [
          "Разбери переписку администратора салона с клиентом. Ответь ТОЛЬКО объектом JSON,",
          "без пояснений и без markdown. Поля:",
          `"intent" — с чем клиент пришёл, одно из: ${INTENTS.join(", ")}.`,
          "\"break_reason\" — почему разговор не закончился записью, одно из: " +
            `${REASONS_FROM_DIALOG.join(", ")}.`,
          "Клиент записался — верни пустую строку.",
          '"unanswered" — дословный вопрос клиента, на который администратор не смог ответить,',
          "или пустая строка.",
        ].join("\n"),
      },
      { role: "user", content: dialog },
    ]);

    const parsed = JSON.parse((reply.content ?? "").replace(/```json|```/g, "").trim()) as {
      intent?: string;
      break_reason?: string;
      unanswered?: string;
    };

    if (parsed.intent && INTENTS.includes(parsed.intent)) session.intentLabel = parsed.intent;
    // Причину, найденную кодом, моделью не перебиваем: код видел результат инструмента,
    // а модель — только текст разговора.
    if (
      !session.breakReason &&
      parsed.break_reason &&
      REASONS_FROM_DIALOG.includes(parsed.break_reason)
    ) {
      session.breakReason = parsed.break_reason;
    }
    if (!session.unanswered && parsed.unanswered) session.unanswered = parsed.unanswered;
  } catch (error) {
    console.warn(
      "[журнал] разбор обращения моделью не удался, оставляю метки от кода:",
      error instanceof Error ? error.message : error
    );
  }

  if (session.reached !== "J3" && !session.breakReason) session.breakReason = "ушёл молча";

  // «Бот не знал ответа» без самого вопроса бесполезно: колонка нужна как раз затем,
  // чтобы пополнять ../faq/ по частоте. Не нашли формулировку — берём последний вопрос.
  if (session.breakReason === "бот не знал ответа" && !session.unanswered) {
    session.unanswered = session.turns.at(-1)?.question ?? "";
  }
}
