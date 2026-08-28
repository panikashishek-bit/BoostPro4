import { PrismaClient } from "@prisma/client";

// Singleton: в dev-режиме Next.js перезагружает модули при каждом изменении,
// поэтому держим один экземпляр клиента на globalThis, чтобы не плодить подключения.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
