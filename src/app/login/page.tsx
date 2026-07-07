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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Log in to Joinboard</h1>
      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Invalid email or password.
        </p>
      )}
      <form action={login} className="flex flex-col gap-3">
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
          placeholder="Password"
          required
          minLength={8}
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-foreground px-3 py-2 text-background"
        >
          Log in
        </button>
      </form>
      <p className="text-sm text-zinc-500">
        No account?{" "}
        <Link href={`/register${callbackQuery}`} className="underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
