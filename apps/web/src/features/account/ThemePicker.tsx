"use client";

import { useActionState, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveTheme } from "@/features/account/theme-actions";
import { THEMES, type ThemeName } from "@/lib/theme";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };
/** "Saving" and an ellipsis (built from its code point: this file stays ASCII). */
const SAVING = `Saving${String.fromCodePoint(0x2026)}`;

/**
 * The colour theme for this browser: three radios (Gate glass, LED night, Dusk). Each swatch is
 * drawn in its own theme (a nested data-theme), page behind accent and LED, and follows light
 * or dark like the rest of the page. Works without JavaScript: the form posts to the action.
 */
export function ThemePicker({ current }: { current: ThemeName }): ReactNode {
  const [state, action] = useActionState(saveTheme, INITIAL);
  return (
    <section aria-labelledby="theme-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="theme-heading" className="font-display text-xl text-ink">
          Colour theme
        </h2>
        <p className="text-sm text-muted">
          Saved on this browser only. Light or dark still follows your device.
        </p>
      </div>
      <form
        action={action}
        className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-3 sm:p-5"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Colour theme</legend>
          {THEMES.map((theme) => (
            <label
              key={theme.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line bg-page px-3 py-3 has-[:checked]:border-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
            >
              <input
                type="radio"
                name="theme"
                value={theme.id}
                defaultChecked={theme.id === current}
                className="size-5 shrink-0 accent-[var(--accent)]"
              />
              {/* On a phone the swatch sits under the words, so the line keeps the full width
                  (at 320 px beside it, it wrapped onto four lines); from sm up it leads the row. */}
              <span
                data-picker-body=""
                className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-bold text-ink">{theme.name}</span>
                  <span className="text-sm text-muted">{theme.line}</span>
                </span>
                <span
                  data-theme={theme.id}
                  aria-hidden="true"
                  className="flex shrink-0 items-center gap-1 self-start rounded-full bg-page p-1.5 ring-1 ring-line sm:order-first sm:self-auto"
                >
                  <span className="size-4 rounded-full bg-accent" />
                  <span className="size-4 rounded-full bg-led" />
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel={SAVING}>
            Use this theme
          </SubmitButton>
          <p aria-live="polite" className="text-sm">
            {state.error ? (
              <span className="font-bold text-danger">{state.error}</span>
            ) : (
              <span className="text-good">{state.notice ?? ""}</span>
            )}
          </p>
        </div>
      </form>
    </section>
  );
}
