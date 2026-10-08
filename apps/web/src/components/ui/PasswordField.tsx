"use client";

import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  name: string;
  hint?: string;
}

/** Like Field, with a show/hide button so a typo can be checked before submitting. */
export function PasswordField({ label, name, hint, id, ...input }: PasswordFieldProps): ReactNode {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? `field-${name}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-bold text-ink">
        {label}
      </label>
      <div className="flex min-h-12 items-center rounded-control border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          aria-describedby={hintId}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-12 min-w-0 flex-1 rounded-control bg-transparent px-4 text-base text-ink placeholder:text-muted/70 focus:outline-none"
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-control text-muted hover:text-ink"
        >
          {visible ? (
            <EyeSlash size={22} aria-hidden="true" />
          ) : (
            <Eye size={22} aria-hidden="true" />
          )}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
