import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import {
  RequestResetForm,
  SetNewPasswordForm,
} from "@/features/auth/components/ForgotPasswordForm";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Reset password" };

interface PageProps {
  searchParams: Promise<{ email?: string; sent?: string }>;
}

/** Two steps on one page: ask for a code, then set a new password with it. */
export default async function ForgotPasswordPage({ searchParams }: PageProps): Promise<ReactNode> {
  if (await currentUser()) redirect("/home");
  const { email, sent } = await searchParams;
  const codeSent = Boolean(sent && email);

  return (
    <AuthShell>
      <section aria-labelledby="reset-heading" className="flex flex-col gap-6">
        <div>
          <h1 id="reset-heading" className="font-display text-title text-ink">
            {codeSent ? "Check your inbox" : "Reset your password"}
          </h1>
          <p className="mt-2 text-muted">
            {codeSent
              ? `If ${email} has an account, a 6-digit code is on its way. It expires in 15 minutes. Look in Junk too.`
              : "Enter your university email. If it has a Lumiback account, we'll send a 6-digit code to set a new password."}
          </p>
        </div>
        {codeSent && email ? (
          <SetNewPasswordForm email={email} />
        ) : (
          <RequestResetForm email={email} />
        )}
      </section>
    </AuthShell>
  );
}
