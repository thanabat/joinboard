import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cards, lists } from "@/db/schema";
import { eq, inArray, and, isNull, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { createBoard } from "./actions";
import { acceptInvite, declineInvite } from "./[id]/actions";
import { ArchivedBoardsSection } from "./ArchivedBoardsSection";

export default async function BoardsPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const myBoards = await db.query.boards.findMany({
    where: and(eq(boards.ownerId, userId), isNull(boards.archivedAt)),
    orderBy: (board, { desc }) => desc(board.createdAt),
  });

  const memberships = await db.query.boardMembers.findMany({
    where: eq(boardMembers.userId, userId),
  });

  const invitedBoardIds = memberships
    .filter((m) => m.status === "invited")
    .map((m) => m.boardId);
  const activeBoardIds = memberships.filter((m) => m.status === "active").map((m) => m.boardId);

  const invitedBoards = invitedBoardIds.length
    ? await db.query.boards.findMany({
        where: and(inArray(boards.id, invitedBoardIds), isNull(boards.archivedAt)),
      })
    : [];
  const sharedBoards = activeBoardIds.length
    ? await db.query.boards.findMany({
        where: and(inArray(boards.id, activeBoardIds), isNull(boards.archivedAt)),
      })
    : [];

  const archivedOwnedBoards = await db.query.boards.findMany({
    where: and(eq(boards.ownerId, userId), isNotNull(boards.archivedAt)),
    orderBy: (board, { desc }) => desc(board.archivedAt),
  });
  const archivedBoardIds = archivedOwnedBoards.map((board) => board.id);
  const archivedBoardLists = archivedBoardIds.length
    ? await db.query.lists.findMany({ where: inArray(lists.boardId, archivedBoardIds) })
    : [];
  const archivedListIds = archivedBoardLists.map((list) => list.id);
  const archivedBoardCards = archivedListIds.length
    ? await db.query.cards.findMany({ where: inArray(cards.listId, archivedListIds) })
    : [];
  const archivedBoards = archivedOwnedBoards.map((board) => {
    const boardListIds = archivedBoardLists.filter((list) => list.boardId === board.id).map((list) => list.id);
    return {
      id: board.id,
      name: board.name,
      key: board.key,
      archivedAt: board.archivedAt!,
      listCount: boardListIds.length,
      cardCount: archivedBoardCards.filter((card) => boardListIds.includes(card.listId)).length,
    };
  });

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-3.5">
          <Link href="/boards" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no next/image benefit */}
            <img src="/joinboard-logo.svg" alt="" width={24} height={24} />
            <span className="font-semibold tracking-tight">Joinboard</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/profile"
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Profile
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
        {invitedBoards.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Invitations</h2>
            <ul className="flex flex-col gap-2">
              {invitedBoards.map((board) => (
                <li
                  key={board.id}
                  className="flex items-center justify-between rounded-lg border bg-primary-tint px-4 py-3"
                >
                  <span className="font-medium">{board.name}</span>
                  <div className="flex gap-4">
                    <form action={acceptInvite.bind(null, board.id)}>
                      <button
                        type="submit"
                        className="cursor-pointer text-sm font-medium text-primary hover:underline"
                      >
                        Accept
                      </button>
                    </form>
                    <form action={declineInvite.bind(null, board.id)}>
                      <button
                        type="submit"
                        className="cursor-pointer text-sm font-medium text-muted-foreground hover:underline"
                      >
                        Decline
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Your boards</h1>
          </div>

          <form action={createBoard} className="flex gap-2">
            <input
              name="name"
              placeholder="New board name"
              required
              className="flex-1 rounded-md border bg-card px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
            >
              Create board
            </button>
          </form>

          {myBoards.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No boards yet — create your first one above.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {myBoards.map((board) => (
                <li key={board.id}>
                  <Link
                    href={`/boards/${board.id}`}
                    className="flex h-24 flex-col justify-between rounded-lg border bg-card p-3.5 shadow-xs transition hover:shadow-md hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{board.name}</span>
                      <span className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                        {board.key}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">Open board →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {sharedBoards.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Shared with you</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sharedBoards.map((board) => (
                <li key={board.id}>
                  <Link
                    href={`/boards/${board.id}`}
                    className="flex h-24 flex-col justify-between rounded-lg border bg-card p-3.5 shadow-xs transition hover:shadow-md hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{board.name}</span>
                      <span className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                        {board.key}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">Open board →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {archivedBoards.length > 0 && <ArchivedBoardsSection boards={archivedBoards} />}
      </main>
    </div>
  );
}
