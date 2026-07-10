"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { activities, boardMembers, boards, cardLabels, cardLinks, cardMembers, cards, checklistItems, comments, labels, lists, sprintRetroItems, sprints, users } from "@/db/schema";
import { and, eq, inArray, isNull, max, or } from "drizzle-orm";
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

type ActivityScope = "global" | "card";

async function logActivity(
  boardId: string,
  userId: string,
  cardId: string | null,
  message: string,
  scope: ActivityScope,
) {
  const [activity] = await db.insert(activities).values({ boardId, userId, cardId, message, scope }).returning();
  return { ...activity, scope: activity.scope as ActivityScope };
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

  const activity = await logActivity(boardId, userId, null, `created list "${trimmed}"`, "global");
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

  const [{ maxNumber }] = await db
    .select({ maxNumber: max(cards.number) })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .where(eq(lists.boardId, list.boardId));

  const [card] = await db
    .insert(cards)
    .values({
      listId,
      number: (maxNumber ?? 0) + 1,
      title: trimmed,
      description: details.description?.trim() || null,
      dueDate: details.dueDate ? new Date(details.dueDate) : null,
      type: details.type,
      priority: details.priority,
      storyPoints: details.storyPoints,
      position: (maxPosition ?? 0) + 1,
      completedAt: list.isDoneList ? new Date() : null,
    })
    .returning();

  const activity = await logActivity(
    list.boardId,
    userId,
    card.id,
    `created card "${trimmed}" in list "${list.title}"`,
    "global",
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
    "global",
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function deleteList(listId: string) {
  const { list, board, userId } = await requireListAccess(listId);

  // Cascades to the list's cards via the cards.listId foreign key.
  await db.delete(lists).where(eq(lists.id, listId));
  const activity = await logActivity(board.id, userId, null, `deleted list "${list.title}"`, "global");
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
  const activity = await logActivity(board.id, userId, cardId, message, "card");
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function deleteCard(cardId: string) {
  const { card, board, userId } = await requireCardAccess(cardId);

  await db.delete(cards).where(eq(cards.id, cardId));
  // No card left to scope this to, so it can only ever show on the board's global feed.
  const activity = await logActivity(board.id, userId, null, `deleted card "${card.title}"`, "global");
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
    .set({
      listId: targetListId,
      position: (maxPosition ?? 0) + 1,
      completedAt: targetList.isDoneList ? new Date() : currentList.isDoneList ? null : card.completedAt,
    })
    .where(eq(cards.id, cardId));

  const activity =
    currentList.id !== targetList.id
      ? await logActivity(
          board.id,
          userId,
          cardId,
          `moved card "${card.title}" from "${currentList.title}" to "${targetList.title}"`,
          "global",
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

  const [{ maxNumber }] = await db
    .select({ maxNumber: max(cards.number) })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .where(eq(lists.boardId, targetBoard.id));

  // Labels, members, sprint assignment, epic assignment, and links are all
  // board-scoped — none of them are valid once the card belongs to a
  // different board.
  await db.delete(cardLabels).where(eq(cardLabels.cardId, cardId));
  await db.delete(cardMembers).where(eq(cardMembers.cardId, cardId));
  await db.delete(cardLinks).where(or(eq(cardLinks.cardId, cardId), eq(cardLinks.linkedCardId, cardId)));

  await db
    .update(cards)
    .set({
      listId: targetListId,
      position: (maxPosition ?? 0) + 1,
      number: (maxNumber ?? 0) + 1,
      sprintId: null,
      epicId: null,
      completedAt: targetList.isDoneList ? new Date() : null,
    })
    .where(eq(cards.id, cardId));

  const activity = await logActivity(
    sourceBoard.id,
    userId,
    null,
    `moved card "${card.title}" to board "${targetBoard.name}"`,
    "global",
  );
  await logActivity(
    targetBoard.id,
    userId,
    cardId,
    `card "${card.title}" moved here from board "${sourceBoard.name}" into list "${targetList.title}"`,
    "global",
  );

  revalidatePath(`/boards/${sourceBoard.id}`);
  revalidatePath(`/boards/${targetBoard.id}`);
  return { activity };
}

const CARD_TYPES = ["task", "backlog_item", "epic"] as const;
const CARD_TYPE_LABELS: Record<(typeof CARD_TYPES)[number], string> = {
  task: "Task",
  backlog_item: "Product Backlog Item",
  epic: "Epic",
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
    "card",
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function setCardEpic(cardId: string, epicId: string | null) {
  const { card, list, userId } = await requireCardAccess(cardId);

  if (card.type === "epic") throw new Error("An epic card cannot be assigned to another epic");

  let epic = null;
  if (epicId) {
    epic = await db.query.cards.findFirst({ where: eq(cards.id, epicId) });
    if (!epic) throw new Error("Epic not found");
    const epicList = await db.query.lists.findFirst({ where: eq(lists.id, epic.listId) });
    if (!epicList || epicList.boardId !== list.boardId) throw new Error("Epic not found");
    if (epic.type !== "epic") throw new Error("That card is not an epic");
  }

  await db.update(cards).set({ epicId }).where(eq(cards.id, cardId));

  const message = epic
    ? `added card "${card.title}" to epic "${epic.title}"`
    : `removed card "${card.title}" from its epic`;
  const activity = await logActivity(list.boardId, userId, cardId, message, "card");
  revalidatePath(`/boards/${list.boardId}`);
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
    "card",
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
    "card",
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
    link.cardId,
    `removed link between "${card.title}" and "${otherCard?.title ?? "a card"}"`,
    "card",
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

export async function createLabel(boardId: string, name: string, color: string) {
  const { userId } = await requireBoardAccess(boardId);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const [label] = await db.insert(labels).values({ boardId, name: trimmed, color }).returning();

  const activity = await logActivity(boardId, userId, null, `created label "${trimmed}"`, "global");
  revalidatePath(`/boards/${boardId}`);
  return { label, activity };
}

export async function deleteLabel(labelId: string) {
  const label = await db.query.labels.findFirst({ where: eq(labels.id, labelId) });
  if (!label) throw new Error("Label not found");
  const { board, userId } = await requireBoardAccess(label.boardId);

  // Cascades to cardLabels via the cardLabel.labelId foreign key.
  await db.delete(labels).where(eq(labels.id, labelId));
  const activity = await logActivity(board.id, userId, null, `deleted label "${label.name}"`, "global");
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
    "card",
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
  const activity = await logActivity(list.boardId, actorId, cardId, message, "card");
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
    "card",
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
    "card",
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
    "card",
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

  // The updates array only carries the destination list, so a card's source
  // list (needed for both the activity message and completedAt tracking)
  // may not be in validLists yet — fetch whatever's missing in one shot.
  const sourceListIds = affectedCards.map((card) => card.listId);
  const missingListIds = sourceListIds.filter((listId) => !validListIds.has(listId));
  const sourceLists = missingListIds.length
    ? await db.query.lists.findMany({ where: inArray(lists.id, missingListIds) })
    : [];
  const listById = new Map([...validLists, ...sourceLists].map((list) => [list.id, list]));

  await Promise.all(
    updates.map((update) => {
      const card = affectedCards.find((candidate) => candidate.id === update.id);
      const sourceList = card ? listById.get(card.listId) : undefined;
      const targetList = listById.get(update.listId);
      const listChanged = card && card.listId !== update.listId;
      const completedAt = !listChanged
        ? card?.completedAt
        : targetList?.isDoneList
          ? new Date()
          : sourceList?.isDoneList
            ? null
            : card?.completedAt;
      return db
        .update(cards)
        .set({ listId: update.listId, position: update.position, completedAt })
        .where(eq(cards.id, update.id));
    }),
  );

  let activity;
  if (moved?.card) {
    const targetList = listById.get(moved.update.listId);
    const sourceList = listById.get(moved.card.listId);
    activity = await logActivity(
      boardId,
      userId,
      moved.card.id,
      `moved card "${moved.card.title}" from "${sourceList?.title ?? "another list"}" to "${targetList?.title ?? "another list"}"`,
      "global",
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

  const activity = await logActivity(boardId, actorId, null, `invited ${trimmedEmail} to the board`, "global");
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
    "global",
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
    "global",
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
    "global",
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

  await logActivity(boardId, session.user.id, null, "joined the board", "global");
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

export async function updateBoard(boardId: string, name: string, key: string) {
  const { board, userId } = await requireBoardAdmin(boardId);

  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Name is required");

  const normalizedKey = key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (!normalizedKey) throw new Error("Prefix must contain at least one letter or number");

  const existing = await db.query.boards.findFirst({ where: eq(boards.key, normalizedKey) });
  if (existing && existing.id !== boardId) {
    throw new Error(`Prefix "${normalizedKey}" is already in use by another board`);
  }

  await db.update(boards).set({ name: trimmedName, key: normalizedKey }).where(eq(boards.id, boardId));

  const changes: string[] = [];
  if (trimmedName !== board.name) changes.push(`renamed board to "${trimmedName}"`);
  if (normalizedKey !== board.key) changes.push(`changed board prefix to "${normalizedKey}"`);
  const message = changes.length > 0 ? changes.join(" and ") : `updated board "${trimmedName}"`;
  const activity = await logActivity(boardId, userId, null, message, "global");

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/boards");
  return { activity, name: trimmedName, key: normalizedKey };
}

// --- Shareable invite link (separate from the by-email invite above — no
// approval step, and works for people who don't have an account yet) ---

export async function generateInviteLink(boardId: string) {
  const { userId } = await requireBoardAdmin(boardId);

  const token = crypto.randomUUID();
  await db.update(boards).set({ inviteToken: token }).where(eq(boards.id, boardId));

  const activity = await logActivity(boardId, userId, null, "created an invite link", "global");
  revalidatePath(`/boards/${boardId}`);
  return { token, activity };
}

export async function revokeInviteLink(boardId: string) {
  const { userId } = await requireBoardAdmin(boardId);

  await db.update(boards).set({ inviteToken: null }).where(eq(boards.id, boardId));

  const activity = await logActivity(boardId, userId, null, "revoked the invite link", "global");
  revalidatePath(`/boards/${boardId}`);
  return { activity };
}

// --- Sprints (a board has at most one non-completed sprint at a time) ---

export async function createSprint(boardId: string, name: string, startDate: string, endDate: string) {
  const { userId } = await requireBoardAccess(boardId);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  // New sprints always start out "planned" — any number of them can coexist
  // (planned ahead of time), even while another sprint is active. Only
  // starting a sprint enforces the one-active-at-a-time rule.
  const [sprint] = await db
    .insert(sprints)
    .values({ boardId, name: trimmed, startDate: new Date(startDate), endDate: new Date(endDate) })
    .returning();

  const activity = await logActivity(boardId, userId, null, `created sprint "${trimmed}"`, "global");
  revalidatePath(`/boards/${boardId}/dashboard`);
  return { sprint, activity };
}

export async function startSprint(sprintId: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
  if (!sprint) throw new Error("Sprint not found");
  const { userId } = await requireBoardAccess(sprint.boardId);
  if (sprint.status !== "planned") throw new Error("Sprint already started");

  const existingActive = await db.query.sprints.findFirst({
    where: and(eq(sprints.boardId, sprint.boardId), eq(sprints.status, "active")),
  });
  if (existingActive) throw new Error("Complete the active sprint before starting another");

  await db.update(sprints).set({ status: "active" }).where(eq(sprints.id, sprintId));

  const activity = await logActivity(sprint.boardId, userId, null, `started sprint "${sprint.name}"`, "global");
  revalidatePath(`/boards/${sprint.boardId}/dashboard`);
  return { activity };
}

export async function completeSprint(sprintId: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
  if (!sprint) throw new Error("Sprint not found");
  const { userId } = await requireBoardAccess(sprint.boardId);

  await db.update(sprints).set({ status: "completed" }).where(eq(sprints.id, sprintId));

  const activity = await logActivity(sprint.boardId, userId, null, `completed sprint "${sprint.name}"`, "global");
  revalidatePath(`/boards/${sprint.boardId}/dashboard`);
  return { activity };
}

export async function setCardSprint(cardId: string, sprintId: string | null) {
  const { card, list, userId } = await requireCardAccess(cardId);

  const doneList = await db.query.lists.findFirst({
    where: and(eq(lists.boardId, list.boardId), eq(lists.isDoneList, true)),
  });
  if (doneList && card.listId === doneList.id) {
    throw new Error("Completed cards can't be moved between sprints");
  }

  if (sprintId) {
    const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
    if (!sprint || sprint.boardId !== list.boardId) throw new Error("Sprint not found");
  }

  await db.update(cards).set({ sprintId }).where(eq(cards.id, cardId));

  const message = sprintId
    ? `added card "${card.title}" to the sprint`
    : `removed card "${card.title}" from the sprint`;
  const activity = await logActivity(list.boardId, userId, cardId, message, "card");
  revalidatePath(`/boards/${list.boardId}`);
  return { activity };
}

async function requireSprintAccess(sprintId: string) {
  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
  if (!sprint) throw new Error("Sprint not found");
  const { board, userId } = await requireBoardAccess(sprint.boardId);
  return { sprint, board, userId };
}

const RETRO_COLUMNS = ["went_well", "to_improve", "action_items"] as const;

export async function createRetroItem(sprintId: string, column: string, content: string) {
  const { sprint, board, userId } = await requireSprintAccess(sprintId);
  if (sprint.status !== "completed") {
    throw new Error("Retrospective notes can only be added once the sprint is completed");
  }
  if (!RETRO_COLUMNS.includes(column as (typeof RETRO_COLUMNS)[number])) throw new Error("Invalid column");

  const trimmed = content.trim();
  if (!trimmed) throw new Error("Content is required");

  const [{ maxPosition }] = await db
    .select({ maxPosition: max(sprintRetroItems.position) })
    .from(sprintRetroItems)
    .where(and(eq(sprintRetroItems.sprintId, sprintId), eq(sprintRetroItems.column, column)));

  const [item] = await db
    .insert(sprintRetroItems)
    .values({ sprintId, column, content: trimmed, authorId: userId, position: (maxPosition ?? 0) + 1 })
    .returning();

  const author = await db.query.users.findFirst({ where: eq(users.id, userId) });

  const activity = await logActivity(
    board.id,
    userId,
    null,
    `added a retro note to sprint "${sprint.name}"`,
    "global",
  );
  revalidatePath(`/boards/${board.id}/sprints/${sprintId}`);
  return { item: { ...item, authorName: author ? displayName(author) : "(unknown)" }, activity };
}

export async function deleteRetroItem(itemId: string) {
  const item = await db.query.sprintRetroItems.findFirst({ where: eq(sprintRetroItems.id, itemId) });
  if (!item) throw new Error("Retro item not found");
  const { sprint, board, userId } = await requireSprintAccess(item.sprintId);
  if (sprint.status !== "completed") {
    throw new Error("Retrospective notes can only be removed once the sprint is completed");
  }

  await db.delete(sprintRetroItems).where(eq(sprintRetroItems.id, itemId));

  const activity = await logActivity(
    board.id,
    userId,
    null,
    `removed a retro note from sprint "${sprint.name}"`,
    "global",
  );
  revalidatePath(`/boards/${board.id}/sprints/${sprint.id}`);
  return { activity };
}

export async function setListDone(listId: string, isDone: boolean) {
  const { list, board, userId } = await requireListAccess(listId);

  if (isDone) {
    const previousDoneList = await db.query.lists.findFirst({
      where: and(eq(lists.boardId, board.id), eq(lists.isDoneList, true)),
    });
    if (previousDoneList && previousDoneList.id !== listId) {
      await db.update(cards).set({ completedAt: null }).where(eq(cards.listId, previousDoneList.id));
    }
    await db
      .update(lists)
      .set({ isDoneList: false })
      .where(and(eq(lists.boardId, board.id), eq(lists.isDoneList, true)));
    await db
      .update(cards)
      .set({ completedAt: new Date() })
      .where(and(eq(cards.listId, listId), isNull(cards.completedAt)));
  } else {
    await db.update(cards).set({ completedAt: null }).where(eq(cards.listId, listId));
  }
  await db.update(lists).set({ isDoneList: isDone }).where(eq(lists.id, listId));

  const activity = await logActivity(
    board.id,
    userId,
    null,
    isDone ? `marked list "${list.title}" as the Done list` : `unmarked list "${list.title}" as the Done list`,
    "global",
  );
  revalidatePath(`/boards/${board.id}`);
  return { activity };
}

// --- Comments (loaded lazily — see getCardComments) ---

export async function getCardComments(cardId: string) {
  await requireCardAccess(cardId);

  const rows = await db.query.comments.findMany({
    where: eq(comments.cardId, cardId),
    orderBy: (comment, { desc }) => desc(comment.createdAt),
  });

  const userIds = [...new Set(rows.map((row) => row.userId))];
  const commentUsers = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];

  return rows.map((row) => {
    const user = commentUsers.find((candidate) => candidate.id === row.userId);
    return {
      id: row.id,
      message: row.message,
      authorId: row.userId,
      authorName: user ? displayName(user) : "(unknown)",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function createComment(cardId: string, message: string) {
  const { card, list, userId } = await requireCardAccess(cardId);

  const trimmed = message.trim();
  if (!trimmed) throw new Error("Comment cannot be empty");

  const [comment] = await db.insert(comments).values({ cardId, userId, message: trimmed }).returning();

  const activity = await logActivity(list.boardId, userId, cardId, `commented on card "${card.title}"`, "card");
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
