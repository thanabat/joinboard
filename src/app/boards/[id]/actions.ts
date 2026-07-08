"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cardLabels, cardMembers, cards, checklistItems, labels, lists, users } from "@/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireBoardAccess(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const board = await db.query.boards.findFirst({ where: eq(boards.id, boardId) });
  if (!board) throw new Error("Board not found");

  if (board.ownerId === session.user.id) return { board, isAdmin: true };

  const membership = await db.query.boardMembers.findFirst({
    where: and(
      eq(boardMembers.boardId, boardId),
      eq(boardMembers.userId, session.user.id),
      eq(boardMembers.status, "active"),
    ),
  });
  if (!membership) throw new Error("Board not found");

  return { board, isAdmin: false };
}

async function requireBoardAdmin(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
  });
  if (!board) throw new Error("Board not found");

  return board;
}

export async function createList(boardId: string, title: string) {
  await requireBoardAccess(boardId);

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

async function requireListAccess(listId: string) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) throw new Error("List not found");
  const { board } = await requireBoardAccess(list.boardId);
  return { list, board };
}

async function requireCardAccess(cardId: string) {
  const card = await db.query.cards.findFirst({ where: eq(cards.id, cardId) });
  if (!card) throw new Error("Card not found");
  const { list, board } = await requireListAccess(card.listId);
  return { card, list, board };
}

export async function createCard(listId: string, title: string) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) throw new Error("List not found");
  await requireBoardAccess(list.boardId);

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
  const { board } = await requireListAccess(listId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db.update(lists).set({ title: trimmed }).where(eq(lists.id, listId));
  revalidatePath(`/boards/${board.id}`);
}

export async function deleteList(listId: string) {
  const { board } = await requireListAccess(listId);

  // Cascades to the list's cards via the cards.listId foreign key.
  await db.delete(lists).where(eq(lists.id, listId));
  revalidatePath(`/boards/${board.id}`);
}

export async function renameCard(cardId: string, title: string) {
  const { board } = await requireCardAccess(cardId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db.update(cards).set({ title: trimmed }).where(eq(cards.id, cardId));
  revalidatePath(`/boards/${board.id}`);
}

export async function updateCard(
  cardId: string,
  updates: { title: string; description: string | null; dueDate: string | null },
) {
  const { board } = await requireCardAccess(cardId);

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
  const { board } = await requireCardAccess(cardId);

  await db.delete(cards).where(eq(cards.id, cardId));
  revalidatePath(`/boards/${board.id}`);
}

export async function moveCard(cardId: string, targetListId: string) {
  const { list: currentList } = await requireCardAccess(cardId);
  const { list: targetList, board } = await requireListAccess(targetListId);

  if (currentList.boardId !== targetList.boardId) throw new Error("List not found");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(cards.position) })
    .from(cards)
    .where(eq(cards.listId, targetListId));

  await db
    .update(cards)
    .set({ listId: targetListId, position: (maxPosition ?? 0) + 1 })
    .where(eq(cards.id, cardId));

  revalidatePath(`/boards/${board.id}`);
}

export async function createLabel(boardId: string, name: string, color: string) {
  await requireBoardAccess(boardId);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const [label] = await db.insert(labels).values({ boardId, name: trimmed, color }).returning();

  revalidatePath(`/boards/${boardId}`);
  return label;
}

export async function deleteLabel(labelId: string) {
  const label = await db.query.labels.findFirst({ where: eq(labels.id, labelId) });
  if (!label) throw new Error("Label not found");
  const { board } = await requireBoardAccess(label.boardId);

  // Cascades to cardLabels via the cardLabel.labelId foreign key.
  await db.delete(labels).where(eq(labels.id, labelId));
  revalidatePath(`/boards/${board.id}`);
}

export async function setCardLabel(cardId: string, labelId: string, assigned: boolean) {
  const { list } = await requireCardAccess(cardId);

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

export async function setCardMember(cardId: string, userId: string, assigned: boolean) {
  const { list, board } = await requireCardAccess(cardId);

  // Only the board owner or an active member can be assigned to a card.
  const isOwner = userId === board.ownerId;
  if (!isOwner) {
    const membership = await db.query.boardMembers.findFirst({
      where: and(
        eq(boardMembers.boardId, board.id),
        eq(boardMembers.userId, userId),
        eq(boardMembers.status, "active"),
      ),
    });
    if (!membership) throw new Error("Not a board member");
  }

  if (assigned) {
    await db.insert(cardMembers).values({ cardId, userId }).onConflictDoNothing();
  } else {
    await db
      .delete(cardMembers)
      .where(and(eq(cardMembers.cardId, cardId), eq(cardMembers.userId, userId)));
  }

  revalidatePath(`/boards/${list.boardId}`);
}

export async function createChecklistItem(cardId: string, title: string) {
  const { list } = await requireCardAccess(cardId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(checklistItems.position) })
    .from(checklistItems)
    .where(eq(checklistItems.cardId, cardId));

  const [item] = await db
    .insert(checklistItems)
    .values({ cardId, title: trimmed, position: (maxPosition ?? 0) + 1 })
    .returning();

  revalidatePath(`/boards/${list.boardId}`);
  return item;
}

export async function renameChecklistItem(itemId: string, title: string) {
  const item = await db.query.checklistItems.findFirst({ where: eq(checklistItems.id, itemId) });
  if (!item) throw new Error("Checklist item not found");
  const { list } = await requireCardAccess(item.cardId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db.update(checklistItems).set({ title: trimmed }).where(eq(checklistItems.id, itemId));
  revalidatePath(`/boards/${list.boardId}`);
}

export async function toggleChecklistItem(itemId: string, completed: boolean) {
  const item = await db.query.checklistItems.findFirst({ where: eq(checklistItems.id, itemId) });
  if (!item) throw new Error("Checklist item not found");
  const { list } = await requireCardAccess(item.cardId);

  await db.update(checklistItems).set({ completed }).where(eq(checklistItems.id, itemId));
  revalidatePath(`/boards/${list.boardId}`);
}

export async function deleteChecklistItem(itemId: string) {
  const item = await db.query.checklistItems.findFirst({ where: eq(checklistItems.id, itemId) });
  if (!item) throw new Error("Checklist item not found");
  const { list } = await requireCardAccess(item.cardId);

  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
  revalidatePath(`/boards/${list.boardId}`);
}

export async function reorderLists(boardId: string, orderedListIds: string[]) {
  await requireBoardAccess(boardId);

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
  await requireBoardAccess(boardId);

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

// --- Board membership (admin-only management + self-service accept/decline) ---

export async function inviteMember(boardId: string, email: string) {
  const board = await requireBoardAdmin(boardId);

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) throw new Error("Email is required");

  const invitee = await db.query.users.findFirst({ where: eq(users.email, trimmedEmail) });
  if (!invitee) throw new Error("No account found with that email");
  if (invitee.id === board.ownerId) throw new Error("That user already owns this board");

  const existing = await db.query.boardMembers.findFirst({
    where: and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, invitee.id)),
  });
  if (existing?.status === "blocked") {
    throw new Error("This user is blocked from this board — unblock them first");
  }

  await db
    .insert(boardMembers)
    .values({ boardId, userId: invitee.id, status: "invited" })
    .onConflictDoUpdate({
      target: [boardMembers.boardId, boardMembers.userId],
      set: { status: "invited" },
    });

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/boards");
  return { userId: invitee.id, email: invitee.email, status: "invited" };
}

export async function removeMember(boardId: string, userId: string) {
  await requireBoardAdmin(boardId);

  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  revalidatePath(`/boards/${boardId}`);
}

export async function blockMember(boardId: string, userId: string) {
  await requireBoardAdmin(boardId);

  await db
    .insert(boardMembers)
    .values({ boardId, userId, status: "blocked" })
    .onConflictDoUpdate({
      target: [boardMembers.boardId, boardMembers.userId],
      set: { status: "blocked" },
    });

  revalidatePath(`/boards/${boardId}`);
}

export async function unblockMember(boardId: string, userId: string) {
  await requireBoardAdmin(boardId);

  // Back to a clean slate — an explicit invite is needed to grant access again.
  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  revalidatePath(`/boards/${boardId}`);
}

export async function acceptInvite(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  await db
    .update(boardMembers)
    .set({ status: "active" })
    .where(
      and(
        eq(boardMembers.boardId, boardId),
        eq(boardMembers.userId, session.user.id),
        eq(boardMembers.status, "invited"),
      ),
    );

  revalidatePath("/boards");
}

export async function declineInvite(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  await db
    .delete(boardMembers)
    .where(
      and(
        eq(boardMembers.boardId, boardId),
        eq(boardMembers.userId, session.user.id),
        eq(boardMembers.status, "invited"),
      ),
    );

  revalidatePath("/boards");
}

// --- Shareable invite link (separate from the by-email invite above — no
// approval step, and works for people who don't have an account yet) ---

export async function generateInviteLink(boardId: string) {
  await requireBoardAdmin(boardId);

  const token = crypto.randomUUID();
  await db.update(boards).set({ inviteToken: token }).where(eq(boards.id, boardId));

  revalidatePath(`/boards/${boardId}`);
  return token;
}

export async function revokeInviteLink(boardId: string) {
  await requireBoardAdmin(boardId);

  await db.update(boards).set({ inviteToken: null }).where(eq(boards.id, boardId));

  revalidatePath(`/boards/${boardId}`);
}
