import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAvailableSlots } from "@/lib/availability";

export const dynamic = "force-dynamic";

// GET /api/availability?masterId=&serviceId=&date=YYYY-MM-DD — свободные слоты.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const masterId = params.get("masterId");
  const serviceId = params.get("serviceId");
  const date = params.get("date");

  if (!masterId || !serviceId || !date) {
    return NextResponse.json(
      { error: "masterId, serviceId и date обязательны" },
      { status: 400 }
    );
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) {
    return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });
  }

  const slots = await getAvailableSlots({ masterId, durationMin: service.durationMin, date });
  return NextResponse.json(slots);
}
