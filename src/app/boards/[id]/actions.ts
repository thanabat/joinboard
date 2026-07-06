"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { boards, cardLabels, cards, labels, lists } from "@/db/schema";
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

async function requireListOwnership(listId: string) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) throw new Error("List not found");
  const board = await requireBoardOwnership(list.boardId);
  return { list, board };
}

async function requireCardOwnership(cardId: string) {
  const card = await db.query.cards.findFirst({ where: eq(cards.id, cardId) });
  if (!card) throw new Error("Card not found");
  const { list, board } = await requireListOwnership(card.listId);
  return { card, list, board };
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

export async function updateList(listId: string, title: string) {
  const { board } = await requireListOwnership(listId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db.update(lists).set({ title: trimmed }).where(eq(lists.id, listId));
  revalidatePath(`/boards/${board.id}`);
}

export async function deleteList(listId: string) {
  const { board } = await requireListOwnership(listId);

  // Cascades to the list's cards via the cards.listId foreign key.
  await db.delete(lists).where(eq(lists.id, listId));
  revalidatePath(`/boards/${board.id}`);
}

export async function renameCard(cardId: string, title: string) {
  const { board } = await requireCardOwnership(cardId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db.update(cards).set({ title: trimmed }).where(eq(cards.id, cardId));
  revalidatePath(`/boards/${board.id}`);
}

export async function updateCard(
  cardId: string,
  updates: { title: string; description: string | null; dueDate: string | null },
) {
  const { board } = await requireCardOwnership(cardId);

  const trimmed = updates.title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db
    .update(cards)
    .set({
      title: trimmed,
      description: updates.description?.trim() || null,
      dueDate: updates.dueDate ? new Date(updates.dueDate) : null,
    })
    .where(eq(cards.id, cardId));

  revalidatePath(`/boards/${board.id}`);
}

export async function deleteCard(cardId: string) {
  const { board } = await requireCardOwnership(cardId);

  await db.delete(cards).where(eq(cards.id, cardId));
  revalidatePath(`/boards/${board.id}`);
}

export async function createLabel(boardId: string, name: string, color: string) {
  await requireBoardOwnership(boardId);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const [label] = await db.insert(labels).values({ boardId, name: trimmed, color }).returning();

  revalidatePath(`/boards/${boardId}`);
  return label;
}

export async function deleteLabel(labelId: string) {
  const label = await db.query.labels.findFirst({ where: eq(labels.id, labelId) });
  if (!label) throw new Error("Label not found");
  const board = await requireBoardOwnership(label.boardId);

  // Cascades to cardLabels via the cardLabel.labelId foreign key.
  await db.delete(labels).where(eq(labels.id, labelId));
  revalidatePath(`/boards/${board.id}`);
}

export async function setCardLabel(cardId: string, labelId: string, assigned: boolean) {
  const { list } = await requireCardOwnership(cardId);

  const label = await db.query.labels.findFirst({ where: eq(labels.id, labelId) });
  if (!label || label.boardId !== list.boardId) throw new Error("Label not found");

  if (assigned) {
    await db.insert(cardLabels).values({ cardId, labelId }).onConflictDoNothing();
  } else {
    await db
      .delete(cardLabels)
      .where(and(eq(cardLabels.cardId, cardId), eq(cardLabels.labelId, labelId)));
  }

  revalidatePath(`/boards/${list.boardId}`);
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
