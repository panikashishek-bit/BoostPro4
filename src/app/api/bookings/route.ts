import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/bookings — создать запись.
export async function POST(req: NextRequest) {
  let body: {
    serviceId?: string;
    masterId?: string;
    startISO?: string;
    clientName?: string;
    clientPhone?: string;
    comment?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const { serviceId, masterId, startISO, clientName, clientPhone, comment } = body;
  if (!serviceId || !masterId || !startISO || !clientName?.trim() || !clientPhone?.trim()) {
    return NextResponse.json({ error: "Заполните все обязательные поля" }, { status: 400 });
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) {
    return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });
  }

  const master = await prisma.master.findUnique({ where: { id: masterId } });
  if (!master) {
    return NextResponse.json({ error: "Мастер не найден" }, { status: 404 });
  }

  const startAt = new Date(startISO);
  if (Number.isNaN(startAt.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
  }
  const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);

  // Защита от двойной записи: пересечение с активными бронями мастера.
  const conflict = await prisma.booking.findFirst({
    where: {
      masterId,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });
  if (conflict) {
    return NextResponse.json({ error: "Это время уже занято, выберите другое" }, { status: 409 });
  }

  const booking = await prisma.booking.create({
    data: {
      serviceId,
      masterId,
      startAt,
      endAt,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      comment: comment?.trim() || null,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: booking.id }, { status: 201 });
}
