"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";

import { signOut } from "@/features/auth/actions";
import { useShare } from "@/features/share/ShareProvider";

/**
 * Sign out of this browser. The form posts the server action directly, so it also works before
 * the page has hydrated (the server's sign-out stops a running tab share). Once hydrated, this
 * tab first stops sending location and stops the tab share it sends (best effort, never
 * blocking), then calls the same action. It calls it rather than re-submitting the form: a
 * re-render can replace the form meanwhile, and a detached form's requestSubmit does nothing.
 */
export function SignOutButton({ className }: { className: string }): ReactNode {
  const { beforeSignOut } = useShare();
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      await beforeSignOut().catch(() => undefined);
      await signOut();
    });
  };

  return (
    <form action={signOut} onSubmit={onSubmit}>
      <button type="submit" className={className} aria-disabled={pending}>
        Sign out
      </button>
    </form>
  );
}
