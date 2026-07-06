import { auth } from "@/auth";
import { db } from "@/db";
import { boards, cards, lists } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
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

  // Ownership check only for now — shared-board access via boardMembers is a follow-up.
  const board = await db.query.boards.findFirst({
    where: and(eq(boards.id, id), eq(boards.ownerId, session!.user!.id)),
  });
  if (!board) notFound();

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
      })),
  }));

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center gap-4">
        <Link href="/boards" className="text-sm underline">
          ← Boards
        </Link>
        <h1 className="text-2xl font-semibold">{board.name}</h1>
      </div>

      <Board boardId={board.id} initialLists={initialLists} />
    </main>
  );
}
