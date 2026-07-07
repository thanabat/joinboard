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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Create your Joinboard account</h1>
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error === "email-taken"
            ? "An account with that email already exists."
            : "Enter a valid email and a password of at least 8 characters."}
        </p>
      )}
      <form action={register} className="flex flex-col gap-3">
        <input
          name="name"
          type="text"
          placeholder="Name"
          className="rounded border px-3 py-2"
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Password (min 8 characters)"
          required
          minLength={8}
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-foreground px-3 py-2 text-background"
        >
          Sign up
        </button>
      </form>
      <p className="text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href={`/login${callbackQuery}`} className="underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
