"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { boards, cards, lists } from "@/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireBoardOwnership(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
  });
  if (!board) throw new Error("Board not found");

  return board;
}

export async function createList(boardId: string, title: string) {
  await requireBoardOwnership(boardId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(lists.position) })
    .from(lists)
    .where(eq(lists.boardId, boardId));

  const [list] = await db
    .insert(lists)
    .values({ boardId, title: trimmed, position: (maxPosition ?? 0) + 1 })
    .returning();

  revalidatePath(`/boards/${boardId}`);
  return list;
}

export async function createCard(listId: string, title: string) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) throw new Error("List not found");
  await requireBoardOwnership(list.boardId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(cards.position) })
    .from(cards)
    .where(eq(cards.listId, listId));

  const [card] = await db
    .insert(cards)
    .values({ listId, title: trimmed, position: (maxPosition ?? 0) + 1 })
    .returning();

  revalidatePath(`/boards/${list.boardId}`);
  return card;
}

export async function reorderLists(boardId: string, orderedListIds: string[]) {
  await requireBoardOwnership(boardId);

  await Promise.all(
    orderedListIds.map((listId, index) =>
      db
        .update(lists)
        .set({ position: index })
        .where(and(eq(lists.id, listId), eq(lists.boardId, boardId))),
    ),
  );

  revalidatePath(`/boards/${boardId}`);
}

export async function reorderCards(
  boardId: string,
  updates: { id: string; listId: string; position: number }[],
) {
  await requireBoardOwnership(boardId);

  // Defense in depth: only allow writing cards into lists that belong to this board.
  const listIds = [...new Set(updates.map((update) => update.listId))];
  const validLists = await db.query.lists.findMany({
    where: and(eq(lists.boardId, boardId), inArray(lists.id, listIds)),
  });
  const validListIds = new Set(validLists.map((list) => list.id));
  if (updates.some((update) => !validListIds.has(update.listId))) {
    throw new Error("Invalid list");
  }

  await Promise.all(
    updates.map((update) =>
      db
        .update(cards)
        .set({ listId: update.listId, position: update.position })
        .where(eq(cards.id, update.id)),
    ),
  );

  revalidatePath(`/boards/${boardId}`);
}
