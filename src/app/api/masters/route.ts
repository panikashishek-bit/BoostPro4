import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET /api/masters?serviceId=... — мастера (опционально только те, кто делает услугу).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const serviceId = req.nextUrl.searchParams.get("serviceId");
  const masters = await prisma.master.findMany({
    where: {
      isActive: true,
      ...(serviceId ? { services: { some: { serviceId } } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, specialty: true },
  });
  return NextResponse.json(masters);
});
