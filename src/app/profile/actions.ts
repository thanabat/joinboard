"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const ROLES = ["Dev", "QA", "UX", "BA", "PO", "PM"] as const;

export async function updateProfile(updates: { name: string | null; nickname: string | null; role: string | null }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  if (updates.role && !ROLES.includes(updates.role as (typeof ROLES)[number])) {
    throw new Error("Invalid role");
  }

  await db
    .update(users)
    .set({
      name: updates.name?.trim() || null,
      nickname: updates.nickname?.trim() || null,
      role: updates.role || null,
    })
    .where(eq(users.id, session.user.id));

  revalidatePath("/profile");
  revalidatePath("/boards");
}
