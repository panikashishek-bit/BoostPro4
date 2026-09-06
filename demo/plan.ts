import { Random } from "./random";
import { CHAT_ID_BASE, CLIENTS, DEMO_DAYS, LOAD, QUESTION_SHARE, SEED, SUCCESS_RATE } from "./settings";

// План учебной истории: что именно будет дорисовано.
//
// Здесь нет ни одной записи наружу — только чистый расчёт. Так его можно
// прогнать и посмотреть глазами, ничего при этом не испортив, и так же он
// проверяется: seed.ts зовёт этот файл, печатает сводку и только потом пишет.
//
// Главное правило файла: НИЧЕГО НЕ ВЫДУМЫВАТЬ. Услуги и мастера приходят
// параметром из базы владельца, статусы и причины взяты из его же настоящих
// строк. Отсебятина здесь — только вымышленные имена клиентов, и они нарочно
// выглядят вымышленными.

/** Услуга и те мастера, которые её реально делают. Приходит из базы приложения. */
export type CatalogueItem = { service: string; masters: string[] };

export type PlannedEvent = {
  at: Date;
  event: "session_start" | "message_in" | "session_success";
  /** Как у бота: у message_in — канал, у session_success — «запись создана». */
  details: string;
  /** Заполняется только у session_start — ровно как это делает бот. */
  gist: string;
};

export type PlannedSession = {
  chatId: number;
  clientNo: number;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  events: PlannedEvent[];
  messages: number;
  channel: "текст" | "голос";
  intent: "вопрос" | "запись";
  succeeded: boolean;
  service: string | null;
  master: string | null;
  reached: "J1" | "J2" | "J3";
  outcome: "ушёл" | "записался";
  breakReason: string | null;
  unanswered: string | null;
  phone: string | null;
  name: string | null;
  gist: string;
  durationSec: number;
};

/**
 * «ГГГГ-ММ-ДД ЧЧ:ММ:СС» по местному времени.
 *
 * Копия moment() из bot_administrator/src/date.ts, и это осознанно: бот —
 * отдельный пакет со своими зависимостями, импортировать оттуда одну функцию
 * значит потянуть его tsconfig в приложение. Формат — договор между тремя
 * местами; разъедься он, ts перестал бы сортироваться как текст.
 */
export function stamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/** «ГГГГ-ММ-ДД». */
export function day(at: Date): string {
  return stamp(at).slice(0, 10);
}

// --- Из чего складываются правдоподобные строки ---

/** Причины срыва — ровно те, что встречаются в настоящих строках таблицы. */
const BREAK_AFTER_QUESTION = ["бот не знал ответа", "нет нужного мастера"] as const;
const BREAK_AFTER_BOOKING = ["ушёл молча", "нет нужного мастера"] as const;

/** Вопросы, на которые бот не нашёл ответа. Общие для салона, без личных данных. */
const UNANSWERED = [
  "А у вас есть подарочные сертификаты?",
  "Вы делаете свадебные причёски?",
  "Можно оплатить переводом?",
  "У вас есть скидки для постоянных клиентов?",
  "Вы работаете в праздники?",
  "Можно оставить машину у входа?",
];

/** Вопросы не про конкретную услугу — их задают в любом салоне. */
const GENERAL_GISTS = [
  "Спрашивал про наличие парковки",
  "Уточнял, до скольки работает салон",
  "Спрашивал, можно ли оплатить картой",
  "Уточнял адрес салона",
  "Спрашивал, есть ли подарочные сертификаты",
  "Уточнял, работает ли салон в воскресенье",
  "Спрашивал, нужна ли предварительная запись",
  "Хотел перенести запись на другой день",
  "Спрашивал, можно ли прийти с ребёнком",
];

/** Рабочее окно салона в минутах от полуночи и то, на сколько его можно раздвинуть в пик. */
const DAY_WINDOW = { from: 10 * 60, to: 20 * 60 };
const BUSY_WINDOW = { from: 9 * 60, to: 21 * 60 + 30 };

/**
 * Сколько минут занимает место одно обращение вместе с обязательной паузой после него.
 *
 * 31 минута — это граница сессии (SESSION_TIMEOUT_MIN = 30) плюс минута сверху:
 * обращения, разделённые ровно тридцатью минутами, бот склеил бы в одно.
 * 24 минуты — потолок длительности самого разговора: шесть сообщений с паузами
 * до четырёх минут, запись в конце и ответ бота. Проверяется потом честно,
 * см. verify(): арифметике на глаз тут верить нельзя.
 */
const SESSION_MAX_MIN = 24;
const SESSION_SLOT_MIN = 31 + SESSION_MAX_MIN;

/**
 * Строит всю учебную историю.
 *
 * `today` — сегодняшний день владельца. Учебные обращения кончаются ВЧЕРА
 * и ни на секунду не заходят на сегодня: сегодняшние цифры на пульте должны
 * быть только настоящими.
 */
export function planDemo(today: Date, catalogue: CatalogueItem[]): PlannedSession[] {
  if (catalogue.length === 0) {
    throw new Error("в базе нет ни одной активной услуги — учебной истории не из чего складывать");
  }

  const random = new Random(SEED);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Дни: от «сегодня минус DEMO_DAYS» до вчера включительно.
  const days: Date[] = [];
  for (let back = DEMO_DAYS; back >= 1; back -= 1) {
    const at = new Date(midnight);
    at.setDate(at.getDate() - back);
    days.push(at);
  }

  const counts = days.map((date) => dailyCount(date, random));
  applySpikes(days, counts, random);

  const sessions: PlannedSession[] = [];
  for (let index = 0; index < days.length; index += 1) {
    sessions.push(...planDay(days[index], counts[index], catalogue, random));
  }
  return sessions;
}

/**
 * Проверяет план на то, ради чего он вообще нужен, — и бросает, если не сходится.
 *
 * Считать эти условия «очевидными из кода» нельзя: любая правка объёма или пауз
 * ломает их молча, а увидеть это можно будет только на пульте, когда цифры уже
 * записаны в три источника. Дешевле упасть здесь.
 */
export function verify(sessions: PlannedSession[], today: Date): void {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  for (const session of sessions) {
    if (session.endedAt.getTime() >= midnight) {
      throw new Error(`обращение ${session.sessionId} заходит на сегодня — граница демо нарушена`);
    }
    for (let index = 1; index < session.events.length; index += 1) {
      if (session.events[index].at.getTime() < session.events[index - 1].at.getTime()) {
        throw new Error(`события ${session.sessionId} идут не по порядку`);
      }
    }
    if (session.succeeded !== session.events.some((event) => event.event === "session_success")) {
      throw new Error(`итог ${session.sessionId} не совпадает с его событиями`);
    }
  }

  // Пауза между соседними обращениями одного дня должна быть больше таймаута
  // сессии, иначе бот считал бы их одним разговором и «обращений» на пульте
  // оказалось бы меньше, чем строк в таблице.
  const byDay = new Map<string, PlannedSession[]>();
  for (const session of sessions) {
    const key = day(session.startedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), session]);
  }

  for (const [date, daily] of byDay) {
    const ordered = [...daily].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    for (let index = 1; index < ordered.length; index += 1) {
      const pause = (ordered[index].startedAt.getTime() - ordered[index - 1].endedAt.getTime()) / 60_000;
      if (pause <= 30) {
        throw new Error(`${date}: между обращениями всего ${pause.toFixed(1)} мин — меньше таймаута сессии`);
      }
    }
  }
}

/** Сколько обращений в этот день. Воскресенье и суббота заметно тише будней. */
function dailyCount(date: Date, random: Random): number {
  const weekday = date.getDay(); // 0 — воскресенье
  if (weekday === 0) return random.int(LOAD.sundayMin, LOAD.sundayMax);
  if (weekday === 6) return random.int(LOAD.saturdayMin, LOAD.saturdayMax);
  return random.int(LOAD.weekdayMin, LOAD.weekdayMax);
}

/**
 * Всплески: пара будних дней, в которые пришло вдвое больше обычного.
 *
 * Без них график — ровный забор, по которому нечему учиться: на настоящих
 * данных всегда есть день, когда что-то случилось.
 */
function applySpikes(days: Date[], counts: number[], random: Random): void {
  const workdays = days
    .map((date, index) => ({ index, weekday: date.getDay() }))
    .filter(({ weekday }) => weekday !== 0 && weekday !== 6)
    .map(({ index }) => index);

  const chosen = new Set<number>();
  // Всплески разносим по разным неделям — два подряд читаются как одна волна.
  while (chosen.size < LOAD.spikeDays && chosen.size < workdays.length) {
    const candidate = random.pick(workdays);
    if ([...chosen].every((index) => Math.abs(index - candidate) > 5)) chosen.add(candidate);
  }

  for (const index of chosen) counts[index] = Math.round(counts[index] * LOAD.spikeFactor);
}

/** Раскладывает обращения одного дня по времени и наполняет каждое. */
function planDay(
  date: Date,
  requested: number,
  catalogue: CatalogueItem[],
  random: Random
): PlannedSession[] {
  // Окно раздвигаем, только если в обычное обращения не помещаются с честными
  // паузами. Ужать паузу нельзя: бот склеил бы соседние обращения в одно,
  // и «обращений» на пульте стало бы меньше, чем строк в таблице.
  const normal = DAY_WINDOW.to - DAY_WINDOW.from;
  const busy = BUSY_WINDOW.to - BUSY_WINDOW.from;
  const window = requested * SESSION_SLOT_MIN <= normal ? DAY_WINDOW : BUSY_WINDOW;
  const length = window === DAY_WINDOW ? normal : busy;
  const count = Math.min(requested, Math.floor(length / SESSION_SLOT_MIN));

  const step = Math.floor(length / Math.max(count, 1));
  const sessions: PlannedSession[] = [];
  // Один и тот же человек в один день дважды не пишет: иначе пришлось бы следить,
  // чтобы между ЕГО обращениями было больше получаса молчания.
  const seenToday = new Set<number>();

  let minute = window.from;
  for (let index = 0; index < count; index += 1) {
    minute += random.int(0, Math.max(0, step - SESSION_SLOT_MIN));

    let clientNo = random.int(1, CLIENTS);
    while (seenToday.has(clientNo)) clientNo = random.int(1, CLIENTS);
    seenToday.add(clientNo);

    const startedAt = new Date(date);
    startedAt.setHours(0, Math.floor(minute), random.int(0, 59), 0);

    sessions.push(planSession(startedAt, clientNo, catalogue, random));

    minute += SESSION_SLOT_MIN;
  }

  return sessions;
}

/** Одно обращение целиком: события внутри, итог и строка для таблицы. */
function planSession(
  startedAt: Date,
  clientNo: number,
  catalogue: CatalogueItem[],
  random: Random
): PlannedSession {
  const chatId = CHAT_ID_BASE + clientNo;
  const sessionId = `${chatId}-${startedAt.getTime()}`;

  // Чем кончилось. Часть обращений ОБЯЗАНА обрываться: без них воронка
  // показала бы ровные 100%, а так не бывает ни у кого.
  const succeeded = random.chance(SUCCESS_RATE);
  const askedOnly = !succeeded && random.chance(QUESTION_SHARE);
  const intent: PlannedSession["intent"] = askedOnly ? "вопрос" : "запись";

  const item = random.weighted(
    catalogue.map((entry, index) => [entry, catalogue.length - index] as const)
  );
  const service = item.service;
  const master = random.pick(item.masters);

  const messages = succeeded ? random.int(3, 6) : askedOnly ? random.int(1, 3) : random.int(2, 4);
  const channel: PlannedSession["channel"] = random.chance(0.15) ? "голос" : "текст";

  const gist = describe(intent, service, random);

  // События внутри обращения идут по порядку, с паузами в пару минут —
  // так выглядит настоящая переписка.
  const events: PlannedEvent[] = [{ at: startedAt, event: "session_start", details: "", gist }];

  let at = startedAt;
  for (let index = 0; index < messages; index += 1) {
    if (index > 0) at = later(at, random.int(1, 3), random);
    events.push({
      at,
      event: "message_in",
      // details у message_in — КАНАЛ, а не текст: текст сплошь и рядом содержит
      // имя и телефон, которые клиент диктует боту. Так это устроено у бота.
      details: index === 0 ? channel : random.chance(0.12) ? "голос" : channel,
      gist: "",
    });
  }

  if (succeeded) {
    at = later(at, random.int(1, 2), random);
    // details тут заготовка: ID созданной записи подставит seed.ts, когда заведёт
    // саму запись, — так же, как это делает бот.
    events.push({ at, event: "session_success", details: "запись создана", gist: "" });
  }

  // Обращение кончается не последней репликой клиента, а ответом бота на неё —
  // несколько секунд спустя. Без этого у обращения в одну реплику «Секунд» = 0,
  // а такого в настоящих строках не бывает: там 3–5 секунд.
  const endedAt = new Date(at.getTime() + random.int(3, 15) * 1000);
  const breakReason = succeeded
    ? null
    : askedOnly
      ? random.weighted([
          [BREAK_AFTER_QUESTION[0], 70],
          [BREAK_AFTER_QUESTION[1], 30],
        ] as const)
      : random.weighted([
          [BREAK_AFTER_BOOKING[0], 80],
          [BREAK_AFTER_BOOKING[1], 20],
        ] as const);

  return {
    chatId,
    clientNo,
    sessionId,
    startedAt,
    endedAt,
    events,
    messages,
    channel,
    intent,
    succeeded,
    // «Услуга» у настоящих строк заполнена только там, где речь шла о записи.
    service: intent === "запись" ? service : null,
    // «Мастер» — только там, где до мастера дошло, то есть у записавшихся.
    master: succeeded ? master : null,
    reached: succeeded ? "J3" : askedOnly ? "J1" : "J2",
    outcome: succeeded ? "записался" : "ушёл",
    breakReason,
    // Вопрос без ответа записан не всегда — так же, как в настоящих строках.
    unanswered:
      breakReason === "бот не знал ответа" && random.chance(0.5) ? random.pick(UNANSWERED) : null,
    phone: succeeded ? phone(clientNo) : null,
    name: succeeded ? `Клиент ${clientNo}` : null,
    gist,
    durationSec: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  };
}

/** Сдвигает время на несколько минут вперёд, с разбросом по секундам. */
function later(at: Date, minutes: number, random: Random): Date {
  return new Date(at.getTime() + minutes * 60_000 + random.int(0, 55) * 1000);
}

/**
 * Короткая суть обращения — та самая, что бот пишет в gist у session_start.
 * Строится из НАСТОЯЩИХ услуг и мастеров владельца, а не из выдуманных.
 */
function describe(
  intent: PlannedSession["intent"],
  service: string,
  random: Random
): string {
  if (intent === "запись") {
    // Имя мастера в эту фразу не ставим: по-русски оно требует дательного падежа
    // («к Марине»), а склонять произвольное имя из базы кодом — источник ляпов.
    // Услуги для «о чём спрашивал» достаточно, а ляп сразу выдаёт выдумку.
    return random.pick([
      `Хотел записаться на ${service.toLowerCase()}`,
      `Спрашивал, есть ли свободное время на ${service.toLowerCase()}`,
      `Уточнял, когда можно прийти на ${service.toLowerCase()}`,
      `Уточнял, сколько стоит ${service.toLowerCase()}`,
    ]);
  }

  return random.pick([
    `Спрашивал, сколько стоит ${service.toLowerCase()}`,
    `Уточнял, сколько длится ${service.toLowerCase()}`,
    ...GENERAL_GISTS,
  ]);
}

/**
 * Телефон вымышленного клиента.
 *
 * Диапазон 900 000-XX-XX выбран так, чтобы номер нельзя было принять
 * за настоящий: реальных людей мы не придумываем даже случайно.
 */
function phone(clientNo: number): string {
  const tail = String(clientNo).padStart(4, "0");
  return `+7 900 000-${tail.slice(0, 2)}-${tail.slice(2)}`;
}
