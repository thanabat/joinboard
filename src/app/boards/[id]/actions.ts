"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { activities, boardMembers, boards, cardLabels, cardLinks, cardMembers, cards, checklistItems, comments, labels, lists, sprints, users } from "@/db/schema";
import { and, eq, inArray, max, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { displayName } from "@/lib/displayName";

async function requireBoardAccess(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const board = await db.query.boards.findFirst({ where: eq(boards.id, boardId) });
  if (!board) throw new Error("Board not found");

  if (board.ownerId === session.user.id) return { board, isAdmin: true, userId: session.user.id };

  const membership = await db.query.boardMembers.findFirst({
    where: and(
      eq(boardMembers.boardId, boardId),
      eq(boardMembers.userId, session.user.id),
      eq(boardMembers.status, "active"),
    ),
  });
  if (!membership) throw new Error("Board not found");

  return { board, isAdmin: false, userId: session.user.id };
}

async function requireBoardAdmin(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, boardId), eq(boards.ownerId, session.user.id)),
  });
  if (!board) throw new Error("Board not found");

  return { board, userId: session.user.id };
}

async function logActivity(boardId: string, userId: string, cardId: string | null, message: string) {
  const [activity] = await db.insert(activities).values({ boardId, userId, cardId, message }).returning();
  return activity;
}

export async function createList(boardId: string, title: string) {
  const { userId } = await requireBoardAccess(boardId);

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

  const activity = await logActivity(boardId, userId, null, `created list "${trimmed}"`);
  revalidatePath(`/boards/${boardId}`);
  return { list, activity };
}

async function requireListAccess(listId: string) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) throw new Error("List not found");
  const { board, userId } = await requireBoardAccess(list.boardId);
  return { list, board, userId };
}

async function requireCardAccess(cardId: string) {
  const card = await db.query.cards.findFirst({ where: eq(cards.id, cardId) });
  if (!card) throw new Error("Card not found");
  const { list, board, userId } = await requireListAccess(card.listId);
  return { card, list, board, userId };
}

export async function createCard(
  listId: string,
  details: {
    title: string;
    description: string | null;
    dueDate: string | null;
    type: string;
    priority: string;
    storyPoints: number | null;
  },
) {
  const list = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
  if (!list) throw new Error("List not found");
  const { userId } = await requireBoardAccess(list.boardId);

  const trimmed = details.title.trim();
  if (!trimmed) throw new Error("Title is required");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(cards.position) })
    .from(cards)
    .where(eq(cards.listId, listId));

  const [card] = await db
    .insert(cards)
    .values({
      listId,
      title: trimmed,
      description: details.description?.trim() || null,
      dueDate: details.dueDate ? new Date(details.dueDate) : null,
      type: details.type,
      priority: details.priority,
      storyPoints: details.storyPoints,
      position: (maxPosition ?? 0) + 1,
    })
    .returning();

  const activity = await logActivity(
    list.boardId,
    userId,
    card.id,
    `created card "${trimmed}" in list "${list.title}"`,
  );
  revalidatePath(`/boards/${list.boardId}`);
  return { card, activity };
}

export async function updateList(listId: string, title: string) {
  const { list, board, userId } = await requireListAccess(listId);

  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title is required");

  await db.update(lists).set({ title: trimmed }).where(eq(lists.id, listId));
  const activity = await logActivity(
    board.id,
    userId,
    null,
    `renamed list "${list.title}" to "${trimmed}"`,
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function deleteList(listId: string) {
  const { list, board, userId } = await requireListAccess(listId);

  // Cascades to the list's cards via the cards.listId foreign key.
  await db.delete(lists).where(eq(lists.id, listId));
  const activity = await logActivity(board.id, userId, null, `deleted list "${list.title}"`);
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function updateCard(
  cardId: string,
  updates: {
    title: string;
    description: string | null;
    dueDate: string | null;
    storyPoints: number | null;
  },
) {
  const { card, board, userId } = await requireCardAccess(cardId);

  const trimmed = updates.title.trim();
  if (!trimmed) throw new Error("Title is required");
  if (updates.storyPoints !== null && (!Number.isInteger(updates.storyPoints) || updates.storyPoints < 0)) {
    throw new Error("Story points must be a non-negative whole number");
  }

  await db
    .update(cards)
    .set({
      title: trimmed,
      description: updates.description?.trim() || null,
      dueDate: updates.dueDate ? new Date(updates.dueDate) : null,
      storyPoints: updates.storyPoints,
    })
    .where(eq(cards.id, cardId));

  const message =
    card.title !== trimmed ? `renamed card "${card.title}" to "${trimmed}"` : `updated card "${trimmed}"`;
  const activity = await logActivity(board.id, userId, cardId, message);
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function deleteCard(cardId: string) {
  const { card, board, userId } = await requireCardAccess(cardId);

  await db.delete(cards).where(eq(cards.id, cardId));
  const activity = await logActivity(board.id, userId, null, `deleted card "${card.title}"`);
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function moveCard(cardId: string, targetListId: string) {
  const { card, list: currentList, userId } = await requireCardAccess(cardId);
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

  const activity =
    currentList.id !== targetList.id
      ? await logActivity(
          board.id,
          userId,
          cardId,
          `moved card "${card.title}" from "${currentList.title}" to "${targetList.title}"`,
        )
      : undefined;
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function moveCardToBoard(cardId: string, targetListId: string) {
  const { card, board: sourceBoard, userId } = await requireCardAccess(cardId);
  const { list: targetList, board: targetBoard } = await requireListAccess(targetListId);

  if (sourceBoard.id === targetBoard.id) throw new Error("Card is already on this board");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(cards.position) })
    .from(cards)
    .where(eq(cards.listId, targetListId));

  // Labels, members, sprint assignment, and links are all board-scoped —
  // none of them are valid once the card belongs to a different board.
  await db.delete(cardLabels).where(eq(cardLabels.cardId, cardId));
  await db.delete(cardMembers).where(eq(cardMembers.cardId, cardId));
  await db.delete(cardLinks).where(or(eq(cardLinks.cardId, cardId), eq(cardLinks.linkedCardId, cardId)));

  await db
    .update(cards)
    .set({ listId: targetListId, position: (maxPosition ?? 0) + 1, sprintId: null })
    .where(eq(cards.id, cardId));

  const activity = await logActivity(
    sourceBoard.id,
    userId,
    null,
    `moved card "${card.title}" to board "${targetBoard.name}"`,
  );
  await logActivity(
    targetBoard.id,
    userId,
    cardId,
    `card "${card.title}" moved here from board "${sourceBoard.name}" into list "${targetList.title}"`,
  );

  revalidatePath(`/boards/${sourceBoard.id}`);
  revalidatePath(`/boards/${targetBoard.id}`);
  return { activity };
}

const CARD_TYPES = ["task", "backlog_item"] as const;
const CARD_TYPE_LABELS: Record<(typeof CARD_TYPES)[number], string> = {
  task: "Task",
  backlog_item: "Product Backlog Item",
};

export async function setCardType(cardId: string, type: string) {
  const { card, board, userId } = await requireCardAccess(cardId);
  if (!CARD_TYPES.includes(type as (typeof CARD_TYPES)[number])) {
    throw new Error("Invalid card type");
  }

  await db.update(cards).set({ type }).where(eq(cards.id, cardId));
  const activity = await logActivity(
    board.id,
    userId,
    cardId,
    `changed card "${card.title}" type to "${CARD_TYPE_LABELS[type as (typeof CARD_TYPES)[number]]}"`,
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

const CARD_PRIORITIES = ["high", "medium", "low"] as const;
const CARD_PRIORITY_LABELS: Record<(typeof CARD_PRIORITIES)[number], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export async function setCardPriority(cardId: string, priority: string) {
  const { card, board, userId } = await requireCardAccess(cardId);
  if (!CARD_PRIORITIES.includes(priority as (typeof CARD_PRIORITIES)[number])) {
    throw new Error("Invalid priority");
  }

  await db.update(cards).set({ priority }).where(eq(cards.id, cardId));
  const activity = await logActivity(
    board.id,
    userId,
    cardId,
    `changed card "${card.title}" priority to "${CARD_PRIORITY_LABELS[priority as (typeof CARD_PRIORITIES)[number]]}"`,
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

const LINK_RELATIONS = ["blocks", "is_blocked_by", "relates_to"] as const;
const LINK_RELATION_LABELS: Record<(typeof LINK_RELATIONS)[number], string> = {
  blocks: "blocks",
  is_blocked_by: "is blocked by",
  relates_to: "relates to",
};

export async function linkCards(cardId: string, targetCardId: string, relation: string) {
  const { card, list, board, userId } = await requireCardAccess(cardId);
  if (!LINK_RELATIONS.includes(relation as (typeof LINK_RELATIONS)[number])) {
    throw new Error("Invalid link relation");
  }
  if (cardId === targetCardId) throw new Error("A card cannot link to itself");

  const targetCard = await db.query.cards.findFirst({ where: eq(cards.id, targetCardId) });
  if (!targetCard) throw new Error("Card not found");
  const { list: targetList } = await requireListAccess(targetCard.listId);
  if (targetList.boardId !== list.boardId) throw new Error("Cards must be on the same board");

  // "is_blocked_by" is stored as the inverse "blocks" row, so the DB only ever holds two type values.
  const [sourceId, otherId, type] =
    relation === "is_blocked_by" ? [targetCardId, cardId, "blocks"] : [cardId, targetCardId, relation];

  const existing = await db.query.cardLinks.findFirst({
    where: and(eq(cardLinks.cardId, sourceId), eq(cardLinks.linkedCardId, otherId), eq(cardLinks.type, type)),
  });
  if (existing) throw new Error("These cards are already linked this way");

  const [link] = await db
    .insert(cardLinks)
    .values({ cardId: sourceId, linkedCardId: otherId, type })
    .returning();

  const activity = await logActivity(
    board.id,
    userId,
    cardId,
    `linked card "${card.title}" to "${targetCard.title}" (${LINK_RELATION_LABELS[relation as (typeof LINK_RELATIONS)[number]]})`,
  );
  revalidatePath(`/boards/${board.id}`);
  return { link, activity };
}

export async function unlinkCards(linkId: string) {
  const link = await db.query.cardLinks.findFirst({ where: eq(cardLinks.id, linkId) });
  if (!link) throw new Error("Link not found");
  const { card, board, userId } = await requireCardAccess(link.cardId);

  const otherCard = await db.query.cards.findFirst({ where: eq(cards.id, link.linkedCardId) });

  await db.delete(cardLinks).where(eq(cardLinks.id, linkId));
  const activity = await logActivity(
    board.id,
    userId,
    null,
    `removed link between "${card.title}" and "${otherCard?.title ?? "a card"}"`,
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function createLabel(boardId: string, name: string, color: string) {
  const { userId } = await requireBoardAccess(boardId);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const [label] = await db.insert(labels).values({ boardId, name: trimmed, color }).returning();

  const activity = await logActivity(boardId, userId, null, `created label "${trimmed}"`);
  revalidatePath(`/boards/${boardId}`);
  return { label, activity };
}

export async function deleteLabel(labelId: string) {
  const label = await db.query.labels.findFirst({ where: eq(labels.id, labelId) });
  if (!label) throw new Error("Label not found");
  const { board, userId } = await requireBoardAccess(label.boardId);

  // Cascades to cardLabels via the cardLabel.labelId foreign key.
  await db.delete(labels).where(eq(labels.id, labelId));
  const activity = await logActivity(board.id, userId, null, `deleted label "${label.name}"`);
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function setCardLabel(cardId: string, labelId: string, assigned: boolean) {
  const { card, list, userId } = await requireCardAccess(cardId);

  const label = await db.query.labels.findFirst({ where: eq(labels.id, labelId) });
  if (!label || label.boardId !== list.boardId) throw new Error("Label not found");

  if (assigned) {
    await db.insert(cardLabels).values({ cardId, labelId }).onConflictDoNothing();
  } else {
    await db
      .delete(cardLabels)
      .where(and(eq(cardLabels.cardId, cardId), eq(cardLabels.labelId, labelId)));
  }

  const activity = await logActivity(
    list.boardId,
    userId,
    cardId,
    `${assigned ? "added" : "removed"} label "${label.name}" ${assigned ? "to" : "from"} card "${card.title}"`,
  );
  revalidatePath(`/boards/${list.boardId}`);
  return { activity };
}

export async function setCardMember(cardId: string, userId: string, assigned: boolean) {
  const { card, list, board, userId: actorId } = await requireCardAccess(cardId);

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

  const targetUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const message =
    actorId === userId
      ? `${assigned ? "joined" : "left"} card "${card.title}"`
      : `${assigned ? "assigned" : "unassigned"} ${targetUser ? displayName(targetUser) : "a member"} ${
          assigned ? "to" : "from"
        } card "${card.title}"`;
  const activity = await logActivity(list.boardId, actorId, cardId, message);
  revalidatePath(`/boards/${list.boardId}`);
  return { activity };
}

export async function createChecklistItem(cardId: string, title: string) {
  const { card, list, userId } = await requireCardAccess(cardId);

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

  const activity = await logActivity(
    list.boardId,
    userId,
    cardId,
    `added checklist item "${trimmed}" to card "${card.title}"`,
  );
  revalidatePath(`/boards/${list.boardId}`);
  return { item, activity };
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
  const { card, list, userId } = await requireCardAccess(item.cardId);

  await db.update(checklistItems).set({ completed }).where(eq(checklistItems.id, itemId));
  const activity = await logActivity(
    list.boardId,
    userId,
    item.cardId,
    `${completed ? "completed" : "reopened"} checklist item "${item.title}" on card "${card.title}"`,
  );
  revalidatePath(`/boards/${list.boardId}`);
  return { activity };
}

export async function deleteChecklistItem(itemId: string) {
  const item = await db.query.checklistItems.findFirst({ where: eq(checklistItems.id, itemId) });
  if (!item) throw new Error("Checklist item not found");
  const { card, list, userId } = await requireCardAccess(item.cardId);

  await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
  const activity = await logActivity(
    list.boardId,
    userId,
    item.cardId,
    `removed checklist item "${item.title}" from card "${card.title}"`,
  );
  revalidatePath(`/boards/${list.boardId}`);
  return { activity };
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
  const { userId } = await requireBoardAccess(boardId);

  // Defense in depth: only allow writing cards into lists that belong to this board.
  const listIds = [...new Set(updates.map((update) => update.listId))];
  const validLists = await db.query.lists.findMany({
    where: and(eq(lists.boardId, boardId), inArray(lists.id, listIds)),
  });
  const validListIds = new Set(validLists.map((list) => list.id));
  if (updates.some((update) => !validListIds.has(update.listId))) {
    throw new Error("Invalid list");
  }

  // Detect a genuine cross-list drag (as opposed to same-list reordering) to log it.
  const affectedCards = await db.query.cards.findMany({
    where: inArray(
      cards.id,
      updates.map((update) => update.id),
    ),
  });
  const moved = updates
    .map((update) => ({ update, card: affectedCards.find((card) => card.id === update.id) }))
    .find(({ update, card }) => card && card.listId !== update.listId);

  await Promise.all(
    updates.map((update) =>
      db
        .update(cards)
        .set({ listId: update.listId, position: update.position })
        .where(eq(cards.id, update.id)),
    ),
  );

  let activity;
  if (moved?.card) {
    const targetList = validLists.find((list) => list.id === moved.update.listId);
    const sourceList =
      validLists.find((list) => list.id === moved.card!.listId) ??
      (await db.query.lists.findFirst({ where: eq(lists.id, moved.card!.listId) }));
    activity = await logActivity(
      boardId,
      userId,
      moved.card.id,
      `moved card "${moved.card.title}" from "${sourceList?.title ?? "another list"}" to "${targetList?.title ?? "another list"}"`,
    );
  }

  revalidatePath(`/boards/${boardId}`);
  return { activity };
}

// --- Board membership (admin-only management + self-service accept/decline) ---

export async function inviteMember(boardId: string, email: string) {
  const { board, userId: actorId } = await requireBoardAdmin(boardId);

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

  const activity = await logActivity(boardId, actorId, null, `invited ${trimmedEmail} to the board`);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/boards");
  return {
    userId: invitee.id,
    email: invitee.email,
    displayName: displayName(invitee),
    status: "invited",
    activity,
  };
}

export async function removeMember(boardId: string, userId: string) {
  const { userId: actorId } = await requireBoardAdmin(boardId);

  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });

  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  const activity = await logActivity(
    boardId,
    actorId,
    null,
    `removed ${target ? displayName(target) : "a member"} from the board`,
  );
  revalidatePath(`/boards/${boardId}`);
  return { activity };
}

export async function blockMember(boardId: string, userId: string) {
  const { userId: actorId } = await requireBoardAdmin(boardId);

  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });

  await db
    .insert(boardMembers)
    .values({ boardId, userId, status: "blocked" })
    .onConflictDoUpdate({
      target: [boardMembers.boardId, boardMembers.userId],
      set: { status: "blocked" },
    });

  const activity = await logActivity(
    boardId,
    actorId,
    null,
    `blocked ${target ? displayName(target) : "a member"}`,
  );
  revalidatePath(`/boards/${boardId}`);
  return { activity };
}

export async function unblockMember(boardId: string, userId: string) {
  const { userId: actorId } = await requireBoardAdmin(boardId);

  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });

  // Back to a clean slate — an explicit invite is needed to grant access again.
  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));

  const activity = await logActivity(
    boardId,
    actorId,
    null,
    `unblocked ${target ? displayName(target) : "a member"}`,
  );
  revalidatePath(`/boards/${boardId}`);
  return { activity };
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

  await logActivity(boardId, session.user.id, null, "joined the board");
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
  const { userId } = await requireBoardAdmin(boardId);

  const token = crypto.randomUUID();
  await db.update(boards).set({ inviteToken: token }).where(eq(boards.id, boardId));

  const activity = await logActivity(boardId, userId, null, "created an invite link");
  revalidatePath(`/boards/${boardId}`);
  return { token, activity };
}

export async function revokeInviteLink(boardId: string) {
  const { userId } = await requireBoardAdmin(boardId);

  await db.update(boards).set({ inviteToken: null }).where(eq(boards.id, boardId));

  const activity = await logActivity(boardId, userId, null, "revoked the invite link");
  revalidatePath(`/boards/${boardId}`);
  return { activity };
}

// --- Sprints (a board has at most one non-completed sprint at a time) ---

export async function createSprint(boardId: string, name: string, startDate: string, endDate: string) {
  const { userId } = await requireBoardAccess(boardId);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const existing = await db.query.sprints.findFirst({
    where: and(eq(sprints.boardId, boardId), inArray(sprints.status, ["planned", "active"])),
  });
  if (existing) throw new Error("Complete the current sprint before creating a new one");

  const [sprint] = await db
    .insert(sprints)
    .values({ boardId, name: trimmed, startDate: new Date(startDate), endDate: new Date(endDate) })
    .returning();

  const activity = await logActivity(boardId, userId, null, `created sprint "${trimmed}"`);
  revalidatePath(`/boards/${boardId}/dashboard`);
  return { sprint, activity };
}

export async function startSprint(sprintId: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
  if (!sprint) throw new Error("Sprint not found");
  const { userId } = await requireBoardAccess(sprint.boardId);
  if (sprint.status !== "planned") throw new Error("Sprint already started");

  await db.update(sprints).set({ status: "active" }).where(eq(sprints.id, sprintId));

  const activity = await logActivity(sprint.boardId, userId, null, `started sprint "${sprint.name}"`);
  revalidatePath(`/boards/${sprint.boardId}/dashboard`);
  return { activity };
}

export async function completeSprint(sprintId: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
  if (!sprint) throw new Error("Sprint not found");
  const { userId } = await requireBoardAccess(sprint.boardId);

  await db.update(sprints).set({ status: "completed" }).where(eq(sprints.id, sprintId));

  const activity = await logActivity(sprint.boardId, userId, null, `completed sprint "${sprint.name}"`);
  revalidatePath(`/boards/${sprint.boardId}/dashboard`);
  return { activity };
}

export async function setCardSprint(cardId: string, sprintId: string | null) {
  const { card, list, userId } = await requireCardAccess(cardId);

  if (sprintId) {
    const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
    if (!sprint || sprint.boardId !== list.boardId) throw new Error("Sprint not found");
  }

  await db.update(cards).set({ sprintId }).where(eq(cards.id, cardId));

  const message = sprintId
    ? `added card "${card.title}" to the sprint`
    : `removed card "${card.title}" from the sprint`;
  const activity = await logActivity(list.boardId, userId, cardId, message);
  revalidatePath(`/boards/${list.boardId}`);
  return { activity };
}

export async function setListDone(listId: string, isDone: boolean) {
  const { list, board, userId } = await requireListAccess(listId);

  if (isDone) {
    await db
      .update(lists)
      .set({ isDoneList: false })
      .where(and(eq(lists.boardId, board.id), eq(lists.isDoneList, true)));
  }
  await db.update(lists).set({ isDoneList: isDone }).where(eq(lists.id, listId));

  const activity = await logActivity(
    board.id,
    userId,
    null,
    isDone ? `marked list "${list.title}" as the Done list` : `unmarked list "${list.title}" as the Done list`,
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

// --- Comments ---

export async function createComment(cardId: string, message: string) {
  const { card, list, userId } = await requireCardAccess(cardId);

  const trimmed = message.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");

  const [comment] = await db.insert(comments).values({ cardId, userId, message: trimmed }).returning();

  const activity = await logActivity(list.boardId, userId, cardId, `commented on card "${card.title}"`);
  revalidatePath(`/boards/${list.boardId}`);
  return { comment, activity };
}

export async function updateComment(commentId: string, message: string) {
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, commentId) });
  if (!comment) throw new Error("Comment not found");
  const { list, userId } = await requireCardAccess(comment.cardId);
  if (comment.userId !== userId) throw new Error("You can only edit your own comments");

  const trimmed = message.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");

  await db
    .update(comments)
    .set({ message: trimmed, updatedAt: new Date() })
    .where(eq(comments.id, commentId));
  revalidatePath(`/boards/${list.boardId}`);
}

export async function deleteComment(commentId: string) {
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, commentId) });
  if (!comment) throw new Error("Comment not found");
  const { list, userId } = await requireCardAccess(comment.cardId);
  if (comment.userId !== userId) throw new Error("You can only delete your own comments");

  await db.delete(comments).where(eq(comments.id, commentId));
  revalidatePath(`/boards/${list.boardId}`);
}
