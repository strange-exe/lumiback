import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import { RegisterForm } from "@/features/auth/components/RegisterForm";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage(): ReactNode {
  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-title text-ink">Create your account</h1>
        <p className="mt-2 text-stone">
          For Graphic Era students. You&apos;ll confirm your university email with a code.
        </p>
      </div>
      <RegisterForm />
    </AuthShell>
  );
}
