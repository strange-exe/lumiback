import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import { VerifyForm } from "@/features/auth/components/VerifyForm";

export const metadata: Metadata = { title: "Verify your email" };

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function VerifyPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { email } = await searchParams;
  if (!email) redirect("/register");

  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-title text-ink">Check your inbox</h1>
        <p className="mt-2 text-muted">
          We sent a 6-digit code to <strong className="break-all text-ink">{email}</strong>. It
          expires in 15 minutes.
        </p>
      </div>
      <VerifyForm email={email} />
    </AuthShell>
  );
}
