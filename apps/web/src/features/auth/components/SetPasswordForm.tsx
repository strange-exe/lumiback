"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  lookUpPasswordLink,
  setPasswordWithLink,
  type SetPasswordState,
} from "@/features/auth/actions";
import { linkTokenFromHash } from "@/features/auth/link-token";
import type { PasswordLinkInfo } from "@/lib/types";

const INITIAL: SetPasswordState = { error: null };

type View =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "gone"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; token: string; info: PasswordLinkInfo };

function Heading({ children }: { children: ReactNode }): ReactNode {
  return (
    <h1 id="set-password-heading" className="font-display text-title text-ink">
      {children}
    </h1>
  );
}

/** The link doesn't work: say why, and offer the way that always works. */
function Gone({ message }: { message: string }): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Heading>This link doesn&apos;t work</Heading>
      <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-ink">
        {message}
      </p>
      <p className="text-muted">
        Ask the hostel office to send a new one, or get one yourself with Forgot password.
      </p>
      <Link
        href="/forgot-password"
        className="flex min-h-11 items-center self-start font-bold text-accent underline-offset-4 hover:underline"
      >
        Forgot password
      </Link>
    </div>
  );
}

/**
 * The page for a set-password link (an imported student's first password, or an admin's
 * reset). The token is in the fragment (#t=...), which never reaches a server: it's read
 * once, removed from the address bar, and sent only in Server Action bodies.
 */
export function SetPasswordForm(): ReactNode {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  // Kept across re-runs (React's dev double effects, "Try again") once it's off the address bar.
  const token = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (token.current === undefined) {
        token.current = linkTokenFromHash(window.location.hash);
        if (window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
      const found = token.current;
      if (!found) {
        setView({ kind: "missing" });
        return;
      }
      try {
        const result = await lookUpPasswordLink(found);
        if (cancelled) return;
        if ("info" in result) setView({ kind: "ready", token: found, info: result.info });
        else if (result.gone) setView({ kind: "gone", message: result.error });
        else setView({ kind: "unavailable", message: result.error });
      } catch {
        if (!cancelled) {
          setView({ kind: "unavailable", message: "Couldn't check your link. Try again." });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (view.kind === "checking") {
    return (
      <div className="flex flex-col gap-2">
        <Heading>Choose a password</Heading>
        <p role="status" className="text-muted">
          Checking your link…
        </p>
      </div>
    );
  }
  if (view.kind === "missing") {
    return (
      <Gone message="This page needs the link from your email. Open it from the email again, the whole link." />
    );
  }
  if (view.kind === "gone") return <Gone message={view.message} />;
  if (view.kind === "unavailable") {
    return (
      <div className="flex flex-col gap-4">
        <Heading>Choose a password</Heading>
        <p role="alert" className="font-bold text-danger">
          {view.message}
        </p>
        <button
          type="button"
          onClick={() => {
            setView({ kind: "checking" });
            setAttempt((n) => n + 1);
          }}
          className="min-h-12 self-start rounded-control bg-surface px-5 font-bold text-accent ring-1 ring-line hover:ring-accent/40"
        >
          Try again
        </button>
      </div>
    );
  }
  return <ChooseForm token={view.token} info={view.info} />;
}

function ChooseForm({ token, info }: { token: string; info: PasswordLinkInfo }): ReactNode {
  const [state, action] = useActionState(setPasswordWithLink, INITIAL);

  if (state.email) {
    return (
      <div className="flex flex-col gap-4">
        <Heading>Password set</Heading>
        <p role="status" className="rounded-control bg-good-soft px-4 py-3 text-ink">
          Password set. Sign in with {state.email}.
        </p>
        <Link
          href={`/sign-in?set=${encodeURIComponent(state.email)}`}
          className="flex min-h-12 items-center justify-center rounded-control bg-accent px-5 font-bold text-on-accent hover:brightness-110"
        >
          Sign in
        </Link>
      </div>
    );
  }
  if (state.gone)
    return <Gone message={state.error ?? "This link has expired or was already used."} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-display text-lg text-muted">Hi {info.name.split(" ")[0]},</p>
        <Heading>{info.invite ? "Choose your password" : "Choose a new password"}</Heading>
        <p className="mt-2 text-muted">
          {info.invite
            ? `Your Lumiback account is ready. Choose a password to sign in with ${info.email}.`
            : `For ${info.email}. Your old password no longer works, and you were signed out everywhere.`}
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="token" value={token} />
        <PasswordField
          label={info.invite ? "Password" : "New password"}
          name="password"
          autoComplete="new-password"
          hint="At least 10 characters. Avoid your name or email."
          required
        />
        <PasswordField label="Type it again" name="confirm" autoComplete="new-password" required />
        <FormError message={state.error} />
        <SubmitButton pendingLabel="Saving…">Set password</SubmitButton>
      </form>
    </div>
  );
}
