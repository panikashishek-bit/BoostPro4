import { prisma } from "@/lib/prisma";
import BookWizard from "./BookWizard";

export const dynamic = "force-dynamic";

// Серверная страница: услуги отдаём с сервера (нет пустого кадра/layout shift),
// читаем ?service=... для предвыбора (deep-link с главной).
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const { service } = await searchParams;
  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, priceRub: true, durationMin: true },
  });

  return <BookWizard initialServices={services} initialServiceId={service ?? null} />;
}
