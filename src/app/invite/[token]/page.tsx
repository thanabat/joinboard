import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const board = await db.query.boards.findFirst({ where: eq(boards.inviteToken, token) });
  if (!board) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Invite link not found</h1>
        <p className="text-muted-foreground">
          This invite link is invalid or has been revoked. Ask the board admin for a new one.
        </p>
        <Link href="/boards" className="text-sm font-medium text-primary hover:underline">
          Go to your boards
        </Link>
      </main>
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    const callbackUrl = `/invite/${token}`;
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          You&apos;re invited to join &ldquo;{board.name}&rdquo;
        </h1>
        <div className="flex justify-center gap-3">
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="rounded-md border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-xs transition hover:bg-muted"
          >
            Log in
          </Link>
          <Link
            href={`/register?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
          >
            Sign up
          </Link>
        </div>
      </main>
    );
  }

  if (board.ownerId === session.user.id) {
    redirect(`/boards/${board.id}`);
  }

  const existing = await db.query.boardMembers.findFirst({
    where: and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, session.user.id)),
  });

  if (existing?.status === "blocked") {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Access denied</h1>
        <p className="text-muted-foreground">You&apos;ve been blocked from this board.</p>
        <Link href="/boards" className="text-sm font-medium text-primary hover:underline">
          Go to your boards
        </Link>
      </main>
    );
  }

  await db
    .insert(boardMembers)
    .values({ boardId: board.id, userId: session.user.id, status: "active" })
    .onConflictDoUpdate({
      target: [boardMembers.boardId, boardMembers.userId],
      set: { status: "active" },
    });

  redirect(`/boards/${board.id}`);
}
