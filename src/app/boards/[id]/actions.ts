"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { boards, cards, lists } from "@/db/schema";
import { and, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function createList(boardId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
  });
  if (!board) throw new Error("Board not found");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(lists.position) })
    .from(lists)
    .where(eq(lists.boardId, boardId));

  await db.insert(lists).values({
    boardId,
    title,
    position: (maxPosition ?? 0) + 1,
  });

  revalidatePath(`/boards/${boardId}`);
}

export async function createCard(listId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const list = await db.query.lists.findFirst({
    where: eq(lists.id, listId),
  });
  if (!list) throw new Error("List not found");

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, list.boardId), eq(boards.ownerId, session.user.id)),
  });
  if (!board) throw new Error("List not found");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(cards.position) })
    .from(cards)
    .where(eq(cards.listId, listId));

  await db.insert(cards).values({
    listId,
    title,
    position: (maxPosition ?? 0) + 1,
  });

  revalidatePath(`/boards/${list.boardId}`);
}
