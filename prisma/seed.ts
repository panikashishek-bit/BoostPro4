import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Чистим в правильном порядке (из-за внешних ключей).
  await prisma.booking.deleteMany();
  await prisma.workingHour.deleteMany();
  await prisma.masterService.deleteMany();
  await prisma.service.deleteMany();
  await prisma.master.deleteMany();

  // --- Услуги (пример: салон. Переоденьте под свой проект — поменяйте этот список.) ---
  const serviceData = [
    { name: "Маникюр", description: "Классический маникюр с покрытием", priceRub: 1800, durationMin: 90 },
    { name: "Педикюр", description: "Аппаратный педикюр", priceRub: 2400, durationMin: 90 },
    { name: "Женская стрижка", description: "Стрижка любой длины", priceRub: 2200, durationMin: 60 },
    { name: "Мужская стрижка", description: "Стрижка и укладка", priceRub: 1500, durationMin: 45 },
    { name: "Окрашивание", description: "Окрашивание в один тон", priceRub: 4500, durationMin: 150 },
    { name: "Солярий", description: "Сеанс вертикального солярия", priceRub: 700, durationMin: 30 },
  ];
  const services = await Promise.all(serviceData.map((data) => prisma.service.create({ data })));
  const service = (name: string) => services.find((s) => s.name === name)!;

  // --- Мастера ---
  const anna = await prisma.master.create({ data: { name: "Анна", specialty: "Ногтевой сервис" } });
  const marina = await prisma.master.create({ data: { name: "Марина", specialty: "Парикмахер-стилист" } });
  const oleg = await prisma.master.create({ data: { name: "Олег", specialty: "Барбер" } });
  const masters = [anna, marina, oleg];

  // --- Кто какие услуги делает ---
  await prisma.masterService.createMany({
    data: [
      { masterId: anna.id, serviceId: service("Маникюр").id },
      { masterId: anna.id, serviceId: service("Педикюр").id },
      { masterId: anna.id, serviceId: service("Солярий").id },
      { masterId: marina.id, serviceId: service("Женская стрижка").id },
      { masterId: marina.id, serviceId: service("Окрашивание").id },
      { masterId: marina.id, serviceId: service("Солярий").id },
      { masterId: oleg.id, serviceId: service("Мужская стрижка").id },
    ],
  });

  // --- График: пн (1) – сб (6), 10:00–20:00 для всех мастеров ---
  await prisma.workingHour.createMany({
    data: masters.flatMap((m) =>
      [1, 2, 3, 4, 5, 6].map((weekday) => ({
        masterId: m.id,
        weekday,
        startMin: 10 * 60,
        endMin: 20 * 60,
      }))
    ),
  });

  // --- Демо-запись на завтра 12:00 ---
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(12, 0, 0, 0);
  const manicure = service("Маникюр");
  await prisma.booking.create({
    data: {
      masterId: anna.id,
      serviceId: manicure.id,
      startAt: start,
      endAt: new Date(start.getTime() + manicure.durationMin * 60_000),
      clientName: "Демо-клиент",
      clientPhone: "+7 900 000-00-00",
      comment: "Пример записи из seed",
    },
  });

  console.log(`Seed готов: услуг — ${services.length}, мастеров — ${masters.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
