import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";

export const metadata: Metadata = { title: "Change password" };

/** Signed in only: the (app) layout sends anyone else to sign in. */
export default function ChangePasswordPage(): ReactNode {
  return (
    <section aria-labelledby="change-password-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/account"
          className="flex min-h-11 items-center self-start text-sm font-bold text-accent underline-offset-4 hover:underline"
        >
          Back to account
        </Link>
        <h1 id="change-password-heading" className="font-display text-title text-ink">
          Change password
        </h1>
        <p className="mt-1 text-muted">
          Every other device signed in to your account is signed out. You stay signed in here.
        </p>
      </div>
      <ChangePasswordForm />
    </section>
  );
}
