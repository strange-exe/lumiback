import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import { SignInForm } from "@/features/auth/components/SignInForm";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

interface PageProps {
  searchParams: Promise<{ verified?: string; deleted?: string }>;
}

export default async function SignInPage({ searchParams }: PageProps): Promise<ReactNode> {
  if (await currentUser()) redirect("/home");
  const { verified, deleted } = await searchParams;

  return (
    <AuthShell>
      <section aria-labelledby="sign-in-heading" className="flex flex-col gap-6">
        <div>
          <h1 id="sign-in-heading" className="font-display text-title text-ink">
            Sign in
          </h1>
          <p className="mt-2 text-muted">Welcome back. Use your university email.</p>
        </div>
        {deleted && (
          <p role="status" className="rounded-control bg-good-soft px-4 py-3 text-ink">
            Your account and all its data were deleted.
          </p>
        )}
        {verified && (
          <p role="status" className="rounded-control bg-good-soft px-4 py-3 text-ink">
            Email verified. Sign in to continue.
          </p>
        )}
        <SignInForm email={verified} />
      </section>
    </AuthShell>
  );
}
