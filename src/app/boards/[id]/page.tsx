import { auth } from "@/auth";
import { db } from "@/db";
import { activities, boardMembers, boards, cardLabels, cardLinks, cardMembers, cards, checklistItems, labels, lists, sprints, users } from "@/db/schema";
import { eq, inArray, and, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { displayName } from "@/lib/displayName";
import { Board } from "./Board";
import { BoardTabs } from "./BoardTabs";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id;

  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) notFound();

  const isAdmin = board.ownerId === userId;
  if (!isAdmin) {
    const membership = await db.query.boardMembers.findFirst({
      where: and(
        eq(boardMembers.boardId, id),
        eq(boardMembers.userId, userId),
        eq(boardMembers.status, "active"),
      ),
    });
    if (!membership) notFound();
  }

  const boardLists = await db.query.lists.findMany({
    where: eq(lists.boardId, id),
    orderBy: (list, { asc }) => asc(list.position),
  });

  const listIds = boardLists.map((list) => list.id);
  const boardCards = listIds.length
    ? await db.query.cards.findMany({
        where: inArray(cards.listId, listIds),
        orderBy: (card, { asc }) => asc(card.position),
      })
    : [];

  const boardLabels = await db.query.labels.findMany({ where: eq(labels.boardId, id) });

  const cardIds = boardCards.map((card) => card.id);
  const cardLabelRows = cardIds.length
    ? await db.query.cardLabels.findMany({ where: inArray(cardLabels.cardId, cardIds) })
    : [];
  const cardMemberRows = cardIds.length
    ? await db.query.cardMembers.findMany({ where: inArray(cardMembers.cardId, cardIds) })
    : [];
  const checklistItemRows = cardIds.length
    ? await db.query.checklistItems.findMany({
        where: inArray(checklistItems.cardId, cardIds),
        orderBy: (item, { asc }) => asc(item.position),
      })
    : [];
  const cardLinkRows = cardIds.length
    ? await db.query.cardLinks.findMany({
        where: or(inArray(cardLinks.cardId, cardIds), inArray(cardLinks.linkedCardId, cardIds)),
      })
    : [];

  const initialLists = boardLists.map((list) => ({
    id: list.id,
    title: list.title,
    isDoneList: list.isDoneList,
    cards: boardCards
      .filter((card) => card.listId === list.id)
      .map((card) => ({
        id: card.id,
        title: card.title,
        description: card.description,
        dueDate: card.dueDate,
        type: card.type as "task" | "backlog_item",
        priority: card.priority as "high" | "medium" | "low",
        storyPoints: card.storyPoints,
        sprintId: card.sprintId,
        labelIds: cardLabelRows
          .filter((row) => row.cardId === card.id)
          .map((row) => row.labelId),
        memberIds: cardMemberRows
          .filter((row) => row.cardId === card.id)
          .map((row) => row.userId),
        checklistItems: checklistItemRows
          .filter((item) => item.cardId === card.id)
          .map((item) => ({ id: item.id, title: item.title, completed: item.completed })),
        links: cardLinkRows
          .filter((row) => row.cardId === card.id || row.linkedCardId === card.id)
          .map((row) => {
            if (row.type === "relates_to") {
              return {
                id: row.id,
                relation: "relates_to" as const,
                otherCardId: row.cardId === card.id ? row.linkedCardId : row.cardId,
              };
            }
            return row.cardId === card.id
              ? { id: row.id, relation: "blocks" as const, otherCardId: row.linkedCardId }
              : { id: row.id, relation: "is_blocked_by" as const, otherCardId: row.cardId };
          }),
      })),
  }));

  const owner = await db.query.users.findFirst({ where: eq(users.id, board.ownerId) });
  const memberRows = await db.query.boardMembers.findMany({ where: eq(boardMembers.boardId, id) });
  const memberUserIds = memberRows.map((row) => row.userId);
  const memberUsers = memberUserIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, memberUserIds) })
    : [];
  const members = memberRows.map((row) => {
    const user = memberUsers.find((candidate) => candidate.id === row.userId);
    return {
      userId: row.userId,
      email: user?.email ?? "(unknown)",
      displayName: user ? displayName(user) : "(unknown)",
      status: row.status,
    };
  });

  const assignableMembers = [
    {
      userId: board.ownerId,
      email: owner?.email ?? "(unknown)",
      displayName: owner ? displayName(owner) : "(unknown)",
    },
    ...memberRows
      .filter((row) => row.status === "active")
      .map((row) => {
        const user = memberUsers.find((candidate) => candidate.id === row.userId);
        return {
          userId: row.userId,
          email: user?.email ?? "(unknown)",
          displayName: user ? displayName(user) : "(unknown)",
        };
      }),
  ];

  const currentSprintRow = await db.query.sprints.findFirst({
    where: and(eq(sprints.boardId, id), or(eq(sprints.status, "planned"), eq(sprints.status, "active"))),
  });
  const currentSprint = currentSprintRow
    ? {
        id: currentSprintRow.id,
        name: currentSprintRow.name,
        status: currentSprintRow.status as "planned" | "active",
        startDate: currentSprintRow.startDate,
        endDate: currentSprintRow.endDate,
      }
    : null;

  const ownedBoards = await db.query.boards.findMany({ where: eq(boards.ownerId, userId) });
  const myMemberships = await db.query.boardMembers.findMany({
    where: and(eq(boardMembers.userId, userId), eq(boardMembers.status, "active")),
  });
  const memberBoardIds = myMemberships.map((row) => row.boardId);
  const memberOfBoards = memberBoardIds.length
    ? await db.query.boards.findMany({ where: inArray(boards.id, memberBoardIds) })
    : [];
  const otherBoardsRaw = [...ownedBoards, ...memberOfBoards].filter((b) => b.id !== id);
  const otherBoardsUnique = Array.from(new Map(otherBoardsRaw.map((b) => [b.id, b])).values());
  const otherBoardIds = otherBoardsUnique.map((b) => b.id);
  const otherBoardLists = otherBoardIds.length
    ? await db.query.lists.findMany({
        where: inArray(lists.boardId, otherBoardIds),
        orderBy: (list, { asc }) => asc(list.position),
      })
    : [];
  const otherBoards = otherBoardsUnique.map((b) => ({
    id: b.id,
    name: b.name,
    lists: otherBoardLists
      .filter((list) => list.boardId === b.id)
      .map((list) => ({ id: list.id, title: list.title })),
  }));

  const activityRows = await db.query.activities.findMany({
    where: eq(activities.boardId, id),
    orderBy: (activity, { desc }) => desc(activity.createdAt),
    limit: 200,
  });
  const activityUserIds = [...new Set(activityRows.map((row) => row.userId))];
  const activityUsers = activityUserIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, activityUserIds) })
    : [];
  const initialActivities = activityRows.map((row) => {
    const user = activityUsers.find((candidate) => candidate.id === row.userId);
    return {
      id: row.id,
      message: row.message,
      actorName: user ? displayName(user) : "(unknown)",
      createdAt: row.createdAt,
    };
  });

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link
              href="/boards"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              ← Boards
            </Link>
            <span className="text-border">/</span>
            <h1 className="text-lg font-semibold tracking-tight">{board.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <BoardTabs boardId={board.id} active="board" />
            <Link
              href="/profile"
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Profile
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-6 py-6">
        <Board
          boardId={board.id}
          initialLists={initialLists}
          initialLabels={boardLabels}
          isAdmin={isAdmin}
          ownerEmail={owner?.email ?? "(unknown)"}
          ownerDisplayName={owner ? displayName(owner) : "(unknown)"}
          initialMembers={members}
          initialInviteToken={board.inviteToken}
          assignableMembers={assignableMembers}
          currentUserId={userId}
          initialActivities={initialActivities}
          initialCurrentSprint={currentSprint}
          otherBoards={otherBoards}
        />
      </main>
    </div>
  );
}
