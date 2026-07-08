import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { updateProfile } from "./actions";

const ROLES = ["Dev", "QA", "UX", "BA", "PO", "PM"] as const;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const session = await auth();
  const userId = session!.user!.id;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) redirect("/boards");

  async function saveProfile(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    const nickname = String(formData.get("nickname") ?? "");
    const role = String(formData.get("role") ?? "");
    await updateProfile({ name: name || null, nickname: nickname || null, role: role || null });
    redirect("/profile?saved=1");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <Link href="/boards" className="flex items-center justify-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no next/image benefit */}
        <img src="/joinboard-logo.svg" alt="" width={28} height={28} />
        <span className="text-lg font-semibold tracking-tight">Joinboard</span>
      </Link>

      <div className="flex flex-col gap-6 rounded-lg border bg-card p-7 shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Your profile</h1>
          <p className="text-sm text-muted-foreground">Update how you appear to others on your boards</p>
        </div>

        {saved && (
          <p className="rounded-md bg-accent-tint px-3 py-2 text-sm text-accent">Profile updated.</p>
        )}

        <form action={saveProfile} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Email
            <input
              type="email"
              value={user.email}
              disabled
              readOnly
              className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Name
            <input
              name="name"
              type="text"
              defaultValue={user.name ?? ""}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Nickname
            <input
              name="nickname"
              type="text"
              defaultValue={user.nickname ?? ""}
              placeholder="Shown instead of your email on boards"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Role
            <select
              name="role"
              defaultValue={user.role ?? ""}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            >
              <option value="">No role</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="mt-1 cursor-pointer rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
          >
            Save profile
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/boards" className="font-medium text-primary hover:underline">
          ← Back to your boards
        </Link>
      </p>
    </main>
  );
}
