import { signIn } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl: initialCallbackUrl, error } = await searchParams;
  const callbackQuery = initialCallbackUrl
    ? `?callbackUrl=${encodeURIComponent(initialCallbackUrl)}`
    : "";

  async function register(formData: FormData) {
    "use server";
    const callbackUrl = initialCallbackUrl;
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim() || null;

    if (!email || password.length < 8) {
      redirect(`/register?error=invalid-input${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`);
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) {
      redirect(`/register?error=email-taken${callbackUrl ? `&callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({ email, name, passwordHash });

    await signIn("credentials", { email, password, redirectTo: callbackUrl || "/boards" });
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <Link href="/" className="flex items-center justify-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo, no next/image benefit */}
        <img src="/joinboard-logo.svg" alt="" width={28} height={28} />
        <span className="text-lg font-semibold tracking-tight">Joinboard</span>
      </Link>

      <div className="flex flex-col gap-6 rounded-lg border bg-card p-7 shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">Start organizing boards in minutes</p>
        </div>

        {error && (
          <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive">
            {error === "email-taken"
              ? "An account with that email already exists."
              : "Enter a valid email and a password of at least 8 characters."}
          </p>
        )}

        <form action={register} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Name
            <input
              name="name"
              type="text"
              autoComplete="name"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-xs font-normal text-muted-foreground">Minimum 8 characters</span>
          </label>
          <button
            type="submit"
            className="mt-1 cursor-pointer rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
          >
            Sign up
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={`/login${callbackQuery}`} className="font-medium text-primary hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
