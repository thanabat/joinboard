import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cardLabels, cardMembers, cards, checklistItems, labels, lists, users } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Board } from "./Board";

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

  const initialLists = boardLists.map((list) => ({
    id: list.id,
    title: list.title,
    cards: boardCards
      .filter((card) => card.listId === list.id)
      .map((card) => ({
        id: card.id,
        title: card.title,
        description: card.description,
        dueDate: card.dueDate,
        type: card.type as "task" | "backlog_item",
        labelIds: cardLabelRows
          .filter((row) => row.cardId === card.id)
          .map((row) => row.labelId),
        memberIds: cardMemberRows
          .filter((row) => row.cardId === card.id)
          .map((row) => row.userId),
        checklistItems: checklistItemRows
          .filter((item) => item.cardId === card.id)
          .map((item) => ({ id: item.id, title: item.title, completed: item.completed })),
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
      status: row.status,
    };
  });

  const assignableMembers = [
    { userId: board.ownerId, email: owner?.email ?? "(unknown)" },
    ...memberRows
      .filter((row) => row.status === "active")
      .map((row) => ({
        userId: row.userId,
        email: memberUsers.find((candidate) => candidate.id === row.userId)?.email ?? "(unknown)",
      })),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-6 py-3.5">
          <Link
            href="/boards"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            ← Boards
          </Link>
          <span className="text-border">/</span>
          <h1 className="text-lg font-semibold tracking-tight">{board.name}</h1>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-6 py-6">
        <Board
          boardId={board.id}
          initialLists={initialLists}
          initialLabels={boardLabels}
          isAdmin={isAdmin}
          ownerEmail={owner?.email ?? "(unknown)"}
          initialMembers={members}
          initialInviteToken={board.inviteToken}
          assignableMembers={assignableMembers}
          currentUserId={userId}
        />
      </main>
    </div>
  );
}
