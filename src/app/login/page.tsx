import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Logo } from "@/components/shell/logo";
import { LoginForm } from "./login-form";
import { ROLE_HOME } from "@/shared/roles";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect(ROLE_HOME[session.user.role]);
  return (
    <main className="grid min-h-svh place-items-center px-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <Logo />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Use the account for your role.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
