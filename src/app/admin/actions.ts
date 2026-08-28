"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

const COOKIE = "admin_auth";

// --- Авторизация ---

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password && password === process.env.ADMIN_PASSWORD) {
    (await cookies()).set(COOKIE, password, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }
  revalidatePath("/admin");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  revalidatePath("/admin");
}

// --- Записи ---

export async function cancelBooking(formData: FormData) {
  await ensureAuth();
  const id = String(formData.get("id"));
  await prisma.booking.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/admin");
}

// --- Услуги ---

export async function addService(formData: FormData) {
  await ensureAuth();
  const name = String(formData.get("name") ?? "").trim();
  const priceRub = Number(formData.get("priceRub"));
  const durationMin = Number(formData.get("durationMin"));
  if (!name || !priceRub || !durationMin) return;
  const masterIds = formData.getAll("masterIds").map(String).filter(Boolean);
  await prisma.service.create({
    data: {
      name,
      priceRub,
      durationMin,
      masters: { create: masterIds.map((masterId) => ({ masterId })) },
    },
  });
  revalidatePath("/admin");
}

export async function toggleService(formData: FormData) {
  await ensureAuth();
  const id = String(formData.get("id"));
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) return;
  await prisma.service.update({ where: { id }, data: { isActive: !service.isActive } });
  revalidatePath("/admin");
}

// Заменить набор мастеров, которые оказывают услугу.
export async function setServiceMasters(formData: FormData) {
  await ensureAuth();
  const serviceId = String(formData.get("serviceId"));
  const masterIds = formData.getAll("masterIds").map(String).filter(Boolean);
  await prisma.$transaction([
    prisma.masterService.deleteMany({ where: { serviceId } }),
    prisma.masterService.createMany({
      data: masterIds.map((masterId) => ({ serviceId, masterId })),
      skipDuplicates: true,
    }),
  ]);
  revalidatePath("/admin");
}

// --- Мастера ---

export async function addMaster(formData: FormData) {
  await ensureAuth();
  const name = String(formData.get("name") ?? "").trim();
  const specialty = String(formData.get("specialty") ?? "").trim() || null;
  if (!name) return;
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  await prisma.master.create({
    data: {
      name,
      specialty,
      services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
    },
  });
  revalidatePath("/admin");
}

export async function updateMaster(formData: FormData) {
  await ensureAuth();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const specialty = String(formData.get("specialty") ?? "").trim() || null;
  if (!name) return;
  await prisma.master.update({ where: { id }, data: { name, specialty } });
  revalidatePath("/admin");
}

export async function toggleMaster(formData: FormData) {
  await ensureAuth();
  const id = String(formData.get("id"));
  const master = await prisma.master.findUnique({ where: { id } });
  if (!master) return;
  await prisma.master.update({ where: { id }, data: { isActive: !master.isActive } });
  revalidatePath("/admin");
}

// Заменить набор услуг, которые делает мастер.
export async function setMasterServices(formData: FormData) {
  await ensureAuth();
  const masterId = String(formData.get("masterId"));
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  await prisma.$transaction([
    prisma.masterService.deleteMany({ where: { masterId } }),
    prisma.masterService.createMany({
      data: serviceIds.map((serviceId) => ({ masterId, serviceId })),
      skipDuplicates: true,
    }),
  ]);
  revalidatePath("/admin");
}

// Локальный помощник (не server action — не экспортируется).
async function ensureAuth() {
  const cookie = (await cookies()).get(COOKIE)?.value;
  if (!cookie || cookie !== process.env.ADMIN_PASSWORD) {
    throw new Error("Не авторизовано");
  }
}
