import type { InputHTMLAttributes, ReactNode, Ref } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Labelled input; the label is always visible (placeholders are examples, not labels). */
export function Field({ label, name, hint, id, className = "", ...input }: FieldProps): ReactNode {
  const inputId = id ?? `field-${name}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-describedby={hintId}
        className={`min-h-12 rounded-control border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none ${className}`}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Form-level error, announced to screen readers when it appears. */
export function FormError({ message }: { message: string | null }): ReactNode {
  return (
    <p role="alert" className="-my-1 min-h-5 text-sm font-bold text-danger empty:min-h-0">
      {message ?? ""}
    </p>
  );
}
