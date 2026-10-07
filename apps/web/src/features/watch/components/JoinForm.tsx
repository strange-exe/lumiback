"use client";

import { useActionState, useEffect, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { joinWithCode } from "@/features/watch/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

/** `signedInAs` is null for guests, who also give a name for the sharer to recognise. */
export function JoinForm({ signedInAs }: { signedInAs: string | null }): ReactNode {
  const [state, action] = useActionState(joinWithCode, INITIAL);

  // Invite links carry the code after "#", which never reaches a server. Read it here, then
  // clear it from the address bar so it doesn't linger in history.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("code");
    const input = document.getElementById("field-code");
    if (fromLink && input instanceof HTMLInputElement) {
      input.value = fromLink;
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  return (
    <form action={action} className="flex flex-col gap-5">
      <Field
        label="Join code"
        name="code"
        defaultValue={state.fields?.code}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="7KQ2M-XW4PD"
        required
        className="font-mono text-lg tracking-widest"
      />
      {signedInAs ? (
        <p className="text-sm text-muted">
          You&apos;re joining as <strong className="text-ink">{signedInAs}</strong>.
        </p>
      ) : (
        <Field
          label="Your name"
          name="name"
          defaultValue={state.fields?.name}
          autoComplete="name"
          maxLength={40}
          required
          hint="They'll see this name when you ask to follow along."
        />
      )}
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Checking the code…" className="w-full text-lg">
        Ask to follow along
      </SubmitButton>
    </form>
  );
}
