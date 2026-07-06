import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { createBoard } from "./actions";

export default async function BoardsPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const myBoards = await db.query.boards.findMany({
    where: eq(boards.ownerId, userId),
    orderBy: (board, { desc }) => desc(board.createdAt),
  });

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
    </main>
  );
}
