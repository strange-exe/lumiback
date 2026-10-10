"use client";

import { useActionState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { markReturn, replyLate } from "@/features/outings/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function ReturnButton(): ReactNode {
  const [state, action] = useActionState(markReturn, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-2">
      <SubmitButton pendingLabel="Welcome back…" className="w-full text-lg">
        I&apos;m back
      </SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}

/** "You're late, are you OK?": an answer stops the escalation to the hostel office. */
export function LateReply(): ReactNode {
  const [state, action] = useActionState(replyLate, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-ink">
        At 30 minutes late we ask if you&apos;re OK; answering now stops the hostel office being
        told. If they are told, they may call you or your emergency contact.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <SubmitButton name="reply" value="on_my_way" variant="secondary" pendingLabel="Sending…">
          On my way
        </SubmitButton>
        <SubmitButton name="reply" value="safe" variant="secondary" pendingLabel="Sending…">
          I&apos;m safe
        </SubmitButton>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
