import { Eye } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { stopViewAs } from "@/features/developer/actions";
import { ViewAsMenu } from "@/features/developer/components/ViewAsMenu";
import { ROLE_LABEL, type ViewRole } from "@/lib/types";

/**
 * While a developer views the site as a role, every signed-in page says so, above everything
 * else, with the View as menu (another role, or Developer) and Stop. The words carry the
 * meaning; the colour only marks it out.
 */
export function ViewAsBanner({ role }: { role: ViewRole }): ReactNode {
  return (
    <section
      aria-label="Viewing as"
      data-view-as={role}
      className="sticky top-0 z-30 border-b border-board-line bg-board text-on-board"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <Eye size={20} weight="bold" aria-hidden="true" className="shrink-0 text-led" />
        <p className="min-w-0 flex-1 text-sm">
          Viewing as <strong>{ROLE_LABEL[role]}</strong>. Read-only.
        </p>
        <div className="flex items-center gap-2">
          <ViewAsMenu current={role} tone="board" />
          <form action={stopViewAs}>
            <SubmitButton pendingLabel="Stopping..." className="min-h-11 px-4 text-sm">
              Stop
            </SubmitButton>
          </form>
        </div>
      </div>
    </section>
  );
}
