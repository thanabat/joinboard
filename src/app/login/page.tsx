import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl: initialCallbackUrl, error } = await searchParams;
  const callbackQuery = initialCallbackUrl
    ? `?callbackUrl=${encodeURIComponent(initialCallbackUrl)}`
    : "";

  async function login(formData: FormData) {
    "use server";
    const callbackUrl = initialCallbackUrl;
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: callbackUrl || "/boards",
      });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect(`/login?error=${error.type}`);
      }
      throw error;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <Link href="/" className="flex items-center justify-center gap-2">
        <span className="h-7 w-7 rounded-md bg-primary" />
        <span className="text-lg font-semibold tracking-tight">Joinboard</span>
      </Link>

      <div className="flex flex-col gap-6 rounded-lg border bg-card p-7 shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Log in to continue to your boards</p>
        </div>

        {error && (
          <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive">
            Invalid email or password.
          </p>
        )}

        <form action={login} className="flex flex-col gap-4">
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
              autoComplete="current-password"
              required
              minLength={8}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>
          <button
            type="submit"
            className="mt-1 cursor-pointer rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
          >
            Log in
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href={`/register${callbackQuery}`} className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
