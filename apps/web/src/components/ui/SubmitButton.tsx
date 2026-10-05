"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type Variant = "primary" | "secondary" | "quiet";

const STYLES: Record<Variant, string> = {
  primary:
    "bg-pine text-on-pine font-bold shadow-[0_2px_0_rgba(0,0,0,0.12)] hover:brightness-110 active:translate-y-px",
  secondary: "bg-surface text-pine font-bold ring-1 ring-line hover:ring-pine/40",
  quiet: "text-pine underline-offset-4 hover:underline",
};

interface SubmitButtonProps {
  children: ReactNode;
  pendingLabel: string;
  variant?: Variant;
  name?: string;
  value?: string;
  className?: string;
}

/** A form's submit button that announces progress and prevents double submits. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  name,
  value,
  className = "",
}: SubmitButtonProps): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={`min-h-12 rounded-control px-5 text-base transition ${STYLES[variant]} ${
        pending ? "cursor-progress opacity-75" : ""
      } ${className}`}
    >
      <span aria-live="polite">{pending ? pendingLabel : children}</span>
    </button>
  );
}
