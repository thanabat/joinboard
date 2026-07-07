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
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-3.5">
          <Link href="/boards" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no next/image benefit */}
            <img src="/joinboard-logo.svg" alt="" width={24} height={24} />
            <span className="font-semibold tracking-tight">Joinboard</span>
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
                    <span className="font-medium">{board.name}</span>
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
                    <span className="font-medium">{board.name}</span>
                    <span className="text-xs text-muted-foreground">Open board →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
