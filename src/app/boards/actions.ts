"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { revalidatePath } from "next/cache";

export async function createBoard(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await db.insert(boards).values({ name, ownerId: session.user.id });
  revalidatePath("/boards");
}
