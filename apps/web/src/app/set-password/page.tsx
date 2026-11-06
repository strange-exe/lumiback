import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import { SetPasswordForm } from "@/features/auth/components/SetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a password",
  robots: { index: false, follow: false },
};

/**
 * Opened from a set-password email (#t=<token>). Works signed out; the token is read in the
 * browser, so this page renders the same for everyone and holds no secret.
 */
export default function SetPasswordPage(): ReactNode {
  return (
    <AuthShell>
      <section aria-labelledby="set-password-heading" className="flex flex-col gap-6">
        <SetPasswordForm />
      </section>
    </AuthShell>
  );
}
