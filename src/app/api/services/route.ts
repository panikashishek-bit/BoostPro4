import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET /api/services — список активных услуг.
export const GET = withErrorHandling(async () => {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, priceRub: true, durationMin: true },
  });
  return NextResponse.json(services);
});
