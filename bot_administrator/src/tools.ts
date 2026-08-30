// Инструменты бота: что он умеет ДЕЛАТЬ через API приложения.
//
// Модель работает НАЗВАНИЯМИ («Маникюр», «Анна»), а не идентификаторами.
// Разрешение названий в id спрятано здесь: API остаётся как есть, а модели
// не приходится тащить cuid через три хода — на этом она чаще всего и ошибается.

import { api, statusOf, type Master, type Service } from "./api.js";
import { normalizePhone } from "./phone.js";
import { ServiceError } from "./retry.js";

/** Описания инструментов для модели (формат OpenAI/OpenRouter). */
export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "find_free_slots",
      description:
        "Показать свободное время на конкретную дату. Вызывай КАЖДЫЙ раз перед тем, как назвать " +
        "клиенту свободное время — даже если уже показывал список на этот день: он мог устареть, " +
        "в том числе из-за записи через сайт. Мастера указывай, только если клиент сам его назвал.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Название услуги, например «Маникюр»" },
          date: { type: "string", description: "Дата в формате ГГГГ-ММ-ДД" },
          master: { type: "string", description: "Имя мастера, если клиент его назвал" },
        },
        required: ["service", "date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_booking",
      description:
        "Записать клиента на услугу. Вызывай только когда известны услуга, дата, время, " +
        "имя и телефон. Телефон обязательно подтверждается у клиента — инструмент подскажет как. " +
        "Время бери из find_free_slots — предлагать время, " +
        "которого там не было, нельзя.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Название услуги" },
          master: { type: "string", description: "Имя мастера" },
          date: { type: "string", description: "Дата в формате ГГГГ-ММ-ДД" },
          time: { type: "string", description: "Время в формате ЧЧ:ММ, как показал find_free_slots" },
          clientName: { type: "string", description: "Имя клиента" },
          clientPhone: { type: "string", description: "Телефон клиента, как он его назвал" },
          phoneConfirmed: {
            type: "boolean",
            description:
              "true — только если клиент уже подтвердил номер в том виде, в каком ты его повторил(а). " +
              "При первом вызове не указывай: инструмент вернёт номер в правильном формате, " +
              "его нужно будет прочитать клиенту и переспросить.",
          },
        },
        required: ["service", "master", "date", "time", "clientName", "clientPhone"],
      },
    },
  },
];

/** Ищет по названию без учёта регистра и склонений в начале слова. */
function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const wanted = name.trim().toLowerCase();
  return (
    items.find((item) => item.name.toLowerCase() === wanted) ??
    items.find((item) => item.name.toLowerCase().startsWith(wanted.slice(0, 5)))
  );
}

async function resolveService(name: string): Promise<Service> {
  const services = await api.services();
  const service = findByName(services, name);
  if (!service) {
    // Это не сбой, а подсказка модели: клиент назвал услугу, которой нет.
    throw new ServiceError(
      `Услуги «${name}» нет. Есть: ${services.map((s) => s.name).join(", ")}.`,
      `услуга не найдена: ${name}`,
      false
    );
  }
  return service;
}

async function resolveMasters(service: Service, name?: string): Promise<Master[]> {
  const masters = await api.masters(service.id);
  if (masters.length === 0) {
    throw new ServiceError(
      `Услугу «${service.name}» сейчас никто не выполняет.`,
      `нет мастеров для услуги ${service.name}`,
      false
    );
  }
  if (!name) return masters;

  const master = findByName(masters, name);
  if (!master) {
    throw new ServiceError(
      `Мастер «${name}» не делает «${service.name}». ` +
        `Эту услугу делают: ${masters.map((m) => m.name).join(", ")}.`,
      `мастер не найден: ${name}`,
      false
    );
  }
  return [master];
}

type FreeSlotsArgs = { service: string; date: string; master?: string };
type BookingArgs = {
  service: string;
  master: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  phoneConfirmed?: boolean;
};

async function findFreeSlots({ service: serviceName, date, master }: FreeSlotsArgs) {
  const service = await resolveService(serviceName);
  const masters = await resolveMasters(service, master);

  const byMaster = await Promise.all(
    masters.map(async (m) => ({
      master: m.name,
      slots: (await api.availability(m.id, service.id, date)).map((s) => s.label),
    }))
  );

  const free = byMaster.filter((entry) => entry.slots.length > 0);
  if (free.length === 0) {
    return {
      service: service.name,
      date,
      free: [],
      note: "На эту дату свободного времени нет — предложи клиенту другой день.",
    };
  }

  return {
    service: service.name,
    durationMin: service.durationMin,
    priceRub: service.priceRub,
    date,
    free,
  };
}

async function createBooking(args: BookingArgs) {
  // Телефон приводим к одному виду сами: клиенты называют его как придётся,
  // а код страны чаще всего опускают. Проверка в коде надёжнее правила в инструкции.
  const phone = normalizePhone(args.clientPhone);
  if (!phone) {
    return {
      ok: false,
      reason:
        `Номер «${args.clientPhone}» не похож на мобильный. ` +
        `Попроси клиента прислать его текстом в виде +7 9XX XXX-XX-XX.`,
    };
  }

  // Запись без подтверждённого номера не создаём: по нему администратор будет
  // звонить, если что-то поменяется, а ошибиться в цифрах на слух легко.
  if (!args.phoneConfirmed) {
    return {
      ok: false,
      needsPhoneConfirmation: true,
      normalizedPhone: phone,
      reason:
        `Прочитай клиенту номер «${phone}» и спроси, верно ли он записан. ` +
        `Запись пока НЕ создана. Когда клиент подтвердит — вызови create_booking ещё раз ` +
        `с тем же номером и phoneConfirmed: true. Если поправит — с новым номером.`,
    };
  }

  const service = await resolveService(args.service);
  const [master] = await resolveMasters(service, args.master);

  // Время берём не из аргументов модели, а из ответа приложения по метке ЧЧ:ММ:
  // так исключаются часовые пояса и выдуманное время.
  const slots = await api.availability(master!.id, service.id, args.date);
  const slot = slots.find((s) => s.label === args.time.trim());
  if (!slot) {
    return {
      ok: false,
      reason:
        `Время ${args.time} у мастера ${master!.name} на ${args.date} недоступно. ` +
        `Свободно: ${slots.map((s) => s.label).join(", ") || "ничего"}.`,
    };
  }

  try {
    await api.createBooking({
      serviceId: service.id,
      masterId: master!.id,
      startISO: slot.startISO,
      clientName: args.clientName,
      clientPhone: phone,
      comment: "Запись через Telegram-бота",
    });
  } catch (error) {
    if (statusOf(error) === 409) {
      return { ok: false, reason: "Это время только что заняли. Предложи клиенту другое." };
    }
    throw error;
  }

  return {
    ok: true,
    booked: {
      service: service.name,
      master: master!.name,
      date: args.date,
      time: slot.label,
      phone,
      priceRub: service.priceRub,
      durationMin: service.durationMin,
    },
  };
}

/** Выполняет инструмент по имени. Результат уходит модели как есть — она пересказывает его клиенту. */
export async function runTool(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "find_free_slots":
      return findFreeSlots(args as FreeSlotsArgs);
    case "create_booking":
      return createBooking(args as BookingArgs);
    default:
      return { error: `Неизвестный инструмент: ${name}` };
  }
}
