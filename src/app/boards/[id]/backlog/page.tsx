import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cards, lists, sprints } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BoardTabs } from "../BoardTabs";
import { BacklogBoard } from "./BacklogBoard";

export default async function BacklogPage({
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

  const boardLists = await db.query.lists.findMany({ where: eq(lists.boardId, id) });
  const doneList = boardLists.find((list) => list.isDoneList);

  const listIds = boardLists.map((list) => list.id);
  const boardCards = listIds.length
    ? await db.query.cards.findMany({
        where: inArray(cards.listId, listIds),
        orderBy: (card, { asc }) => asc(card.number),
      })
    : [];

  const boardSprints = await db.query.sprints.findMany({
    where: eq(sprints.boardId, id),
    orderBy: (sprint, { asc }) => asc(sprint.startDate),
  });

  const initialSprints = boardSprints.map((sprint) => ({
    id: sprint.id,
    name: sprint.name,
    status: sprint.status as "planned" | "active" | "completed",
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  }));

  const initialCards = boardCards.map((card) => ({
    id: card.id,
    number: card.number,
    title: card.title,
    type: card.type as "task" | "backlog_item" | "epic",
    priority: card.priority as "high" | "medium" | "low",
    storyPoints: card.storyPoints,
    sprintId: card.sprintId,
    dueDate: card.dueDate,
    isDone: doneList ? card.listId === doneList.id : false,
  }));

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
            <BoardTabs boardId={board.id} active="backlog" />
            <Link
              href="/profile"
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Profile
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        <BacklogBoard
          boardId={board.id}
          boardKey={board.key}
          hasDoneList={!!doneList}
          initialSprints={initialSprints}
          initialCards={initialCards}
        />
      </main>
    </div>
  );
}
