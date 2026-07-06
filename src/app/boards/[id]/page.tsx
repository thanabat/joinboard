import { auth } from "@/auth";
import { db } from "@/db";
import { boards, cards, lists } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createCard, createList } from "./actions";

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

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center gap-4">
        <Link href="/boards" className="text-sm underline">
          ← Boards
        </Link>
        <h1 className="text-2xl font-semibold">{board.name}</h1>
      </div>

      <div className="flex gap-4 overflow-x-auto">
        {boardLists.map((list) => (
          <div key={list.id} className="w-64 shrink-0 rounded border p-3">
            <h2 className="mb-2 font-medium">{list.title}</h2>
            <ul className="mb-3 flex flex-col gap-2">
              {boardCards
                .filter((card) => card.listId === list.id)
                .map((card) => (
                  <li
                    key={card.id}
                    className="rounded bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
                  >
                    {card.title}
                  </li>
                ))}
            </ul>
            <form action={createCard.bind(null, list.id)} className="flex flex-col gap-2">
              <input
                name="title"
                placeholder="New card title"
                required
                className="rounded border px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded bg-foreground px-2 py-1.5 text-sm text-background"
              >
                Add card
              </button>
            </form>
          </div>
        ))}

        <form
          action={createList.bind(null, board.id)}
          className="flex w-64 shrink-0 flex-col gap-2 rounded border border-dashed p-3"
        >
          <input
            name="title"
            placeholder="New list title"
            required
            className="rounded border px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-foreground px-2 py-1.5 text-sm text-background"
          >
            Add list
          </button>
        </form>
      </div>
    </main>
  );
}
