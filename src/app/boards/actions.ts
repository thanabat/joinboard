"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Best-effort abbreviation of the board name into a short reference key
// (e.g. "Development Team" -> "DT", "Marketing" -> "MARK"). Falls back to
// "BRD" when the name has no ASCII letters/digits to draw from.
function baseBoardKey(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (words.length === 0) return "BRD";
  if (words.length === 1) return words[0].slice(0, 4);
  return words
    .slice(0, 4)
    .map((word) => word[0])
    .join("");
}

async function generateUniqueBoardKey(name: string): Promise<string> {
  const base = baseBoardKey(name) || "BRD";
  let candidate = base;
  let suffix = 2;
  while (await db.query.boards.findFirst({ where: eq(boards.key, candidate) })) {
    candidate = `${base}${suffix}`;
    suffix++;
  }
  return candidate;
}

export async function createBoard(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const key = await generateUniqueBoardKey(name);
  await db.insert(boards).values({ name, ownerId: session.user.id, key });
  revalidatePath("/boards");
}
