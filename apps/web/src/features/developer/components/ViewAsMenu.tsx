"use client";

import { CaretDown, Check } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { chooseViewAs } from "@/features/developer/actions";
import { ROLE_LABEL, type ViewRole } from "@/lib/types";
import { VIEW_CHOICES, type ViewChoice } from "@/lib/view-as";

/** The closing fade (view-as-out in globals.css). */
const CLOSE_MS = 120;

const BUTTON_TONE = {
  /** On the page (the office's nav). */
  page: "text-muted ring-1 ring-line hover:bg-accent-soft hover:text-ink",
  /** On the dark board (the View as banner). */
  board: "text-on-board ring-1 ring-board-muted hover:bg-board-line",
} as const;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Focus = "checked" | "first" | "last";

/**
 * "View as": a menu button (WAI-ARIA APG menu button) whose menu holds five menuitemradio
 * items, Developer and the four roles, the current one checked. Enter, Space or Down opens it
 * on the checked item, Up on the last; Up/Down move (wrapping), Home/End jump, Enter/Space
 * choose, Escape closes and puts focus back on the button, Tab closes and moves on. Choosing
 * runs a Server Action that sets (or clears) the role cookie and opens that role's home.
 */
export function ViewAsMenu({
  current,
  tone = "page",
}: {
  /** The role being viewed now, or null for yourself (Developer). */
  current: ViewRole | null;
  tone?: keyof typeof BUTTON_TONE;
}): ReactNode {
  const id = useId();
  const buttonId = `${id}-button`;
  const menuId = `${id}-menu`;
  const checked: ViewChoice = current ?? "developer";

  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [focusOn, setFocusOn] = useState<Focus>("checked");
  const [pending, startTransition] = useTransition();

  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const closeTimer = useRef<number | undefined>(undefined);

  const close = useCallback((returnFocus: boolean) => {
    if (returnFocus) button.current?.focus();
    window.clearTimeout(closeTimer.current);
    if (reducedMotion()) {
      setOpen(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
  }, []);

  function openMenu(focus: Focus): void {
    if (pending) return;
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setFocusOn(focus);
    setOpen(true);
  }

  // Focus moves into the menu once it's on the page.
  useEffect(() => {
    if (!open || closing) return;
    const index =
      focusOn === "first"
        ? 0
        : focusOn === "last"
          ? VIEW_CHOICES.length - 1
          : VIEW_CHOICES.indexOf(checked);
    items.current[index]?.focus();
  }, [open, closing, focusOn, checked]);

  // A press anywhere else closes it (focus stays where the press put it).
  useEffect(() => {
    if (!open || closing) return;
    function onPointerDown(event: PointerEvent): void {
      if (!wrap.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, closing, close]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function choose(choice: ViewChoice): void {
    close(true);
    if (pending) return;
    startTransition(async () => {
      await chooseViewAs(choice);
    });
  }

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("checked");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>): void {
    const count = VIEW_CHOICES.length;
    const at = items.current.findIndex((item) => item === document.activeElement);
    const move = (index: number) => items.current[(index + count) % count]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(at + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(at - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(count - 1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false); // focus moves on as usual
        break;
    }
  }

  const expanded = open && !closing;
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        id={buttonId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={open ? menuId : undefined}
        aria-busy={pending || undefined}
        onClick={() => (expanded ? close(true) : openMenu("checked"))}
        onKeyDown={onButtonKey}
        className={`press flex min-h-11 items-center gap-1.5 rounded-control px-3 text-sm font-bold ${
          BUTTON_TONE[tone]
        } ${pending ? "cursor-progress opacity-75" : ""}`}
      >
        <span aria-live="polite">{pending ? "Switching..." : "View as"}</span>
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          data-state={closing ? "closing" : "open"}
          onKeyDown={onMenuKey}
          className="view-as-menu absolute right-0 top-full z-40 mt-2 flex w-56 max-w-[calc(100vw-2rem)] flex-col gap-0.5 rounded-card border border-line bg-raised p-1.5 text-ink shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)]"
        >
          {VIEW_CHOICES.map((choice, index) => {
            const isChecked = choice === checked;
            return (
              <button
                key={choice}
                ref={(el) => {
                  items.current[index] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isChecked}
                tabIndex={-1}
                onClick={() => choose(choice)}
                className={`flex min-h-11 items-center gap-2 rounded-control px-3 text-left text-sm hover:bg-accent-soft focus:bg-accent-soft ${
                  isChecked ? "font-bold" : ""
                }`}
              >
                <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
                  {isChecked ? <Check size={16} weight="bold" /> : null}
                </span>
                {ROLE_LABEL[choice]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
