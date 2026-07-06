import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cardLabels, cards, labels, lists, users } from "@/db/schema";
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
        labelIds: cardLabelRows
          .filter((row) => row.cardId === card.id)
          .map((row) => row.labelId),
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

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center gap-4">
        <Link href="/boards" className="text-sm underline">
          ← Boards
        </Link>
        <h1 className="text-2xl font-semibold">{board.name}</h1>
      </div>

      <Board
        boardId={board.id}
        initialLists={initialLists}
        initialLabels={boardLabels}
        isAdmin={isAdmin}
        ownerEmail={owner?.email ?? "(unknown)"}
        initialMembers={members}
      />
    </main>
  );
}
