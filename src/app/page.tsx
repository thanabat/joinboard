import { auth } from "@/auth";
import Link from "next/link";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold">Joinboard</h1>
      <p className="max-w-md text-zinc-500">
        A Trello-style kanban board. Organize boards, lists, and cards.
      </p>
      {session?.user ? (
        <Link
          href="/boards"
          className="rounded bg-foreground px-5 py-2.5 text-background"
        >
          Go to your boards
        </Link>
      ) : (
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded border px-5 py-2.5"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded bg-foreground px-5 py-2.5 text-background"
          >
            Sign up
          </Link>
        </div>
      )}
    </main>
  );
}
