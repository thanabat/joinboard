import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { createBoard } from "./actions";
import { acceptInvite, declineInvite } from "./[id]/actions";

export default async function BoardsPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const myBoards = await db.query.boards.findMany({
    where: eq(boards.ownerId, userId),
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
    ? await db.query.boards.findMany({ where: inArray(boards.id, invitedBoardIds) })
    : [];
  const sharedBoards = activeBoardIds.length
    ? await db.query.boards.findMany({ where: inArray(boards.id, activeBoardIds) })
    : [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your boards</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit" className="text-sm underline">
            Log out
          </button>
        </form>
      </div>

      {invitedBoards.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Invitations</h2>
          <ul className="flex flex-col gap-2">
            {invitedBoards.map((board) => (
              <li
                key={board.id}
                className="flex items-center justify-between rounded border px-4 py-3"
              >
                <span>{board.name}</span>
                <div className="flex gap-3">
                  <form action={acceptInvite.bind(null, board.id)}>
                    <button type="submit" className="text-sm underline">
                      Accept
                    </button>
                  </form>
                  <form action={declineInvite.bind(null, board.id)}>
                    <button type="submit" className="text-sm text-zinc-500 underline">
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={createBoard} className="flex gap-2">
        <input
          name="name"
          placeholder="New board name"
          required
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-foreground px-3 py-2 text-background"
        >
          Create board
        </button>
      </form>

      {myBoards.length === 0 ? (
        <p className="text-zinc-500">No boards yet — create your first one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {myBoards.map((board) => (
            <li key={board.id}>
              <Link
                href={`/boards/${board.id}`}
                className="block rounded border px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                {board.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {sharedBoards.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Shared with you</h2>
          <ul className="flex flex-col gap-2">
            {sharedBoards.map((board) => (
              <li key={board.id}>
                <Link
                  href={`/boards/${board.id}`}
                  className="block rounded border px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  {board.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
