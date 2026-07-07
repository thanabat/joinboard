import { auth } from "@/auth";
import Link from "next/link";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no next/image benefit */}
      <img src="/joinboard-logo.svg" alt="Joinboard" width={56} height={56} />
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Joinboard</h1>
        <p className="max-w-md text-muted-foreground">
          A Trello-style kanban board. Organize boards, lists, and cards — together.
        </p>
      </div>
      {session?.user ? (
        <Link
          href="/boards"
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
        >
          Go to your boards
        </Link>
      ) : (
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded-md border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-xs transition hover:bg-muted"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
          >
            Sign up
          </Link>
        </div>
      )}
    </main>
  );
}
