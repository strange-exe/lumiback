"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { holeFor, holeRadius, placeCardTop, placeCardX, type Rect } from "./place";
import {
  planTour,
  stepText,
  tourLabel,
  type Audience,
  type TargetId,
  type TourPlan,
} from "./steps";
import { browserStorage, onReplay, readSeen, takeReplay, tourAllowed, writeSeen } from "./store";

/** Time for the page under the tour to settle before it looks for its controls. */
const SETTLE_MS = 600;
/** How long to wait for a page to show the tour's first control (after Take the tour again). */
const FIND_MS = 4000;
/** The closing fade (tour-out in globals.css). */
const CLOSE_MS = 160;

type Status = "checking" | "none" | "open" | "done";

/** The element a step points at, if it's on the page and visible. */
function findTarget(id: TargetId): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const visible =
      typeof el.checkVisibility === "function"
        ? el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
        : el.getClientRects().length > 0;
    const box = el.getBoundingClientRect();
    if (visible && box.width > 0 && box.height > 0) return el;
  }
  return null;
}

/** Another dialog is open (a confirm, a correction form): the tour never stacks on it. */
function otherDialogOpen(): boolean {
  return document.querySelector("dialog[open]:not([data-tour-dialog])") !== null;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keeps the steps whose control is on this page. Waits (up to `patience`) for the first step's
 * control to appear and for any other dialog to close. Null: nothing to show, or not now.
 */
async function onPage(plan: TourPlan, patience: number): Promise<TourPlan | null> {
  const first = plan.steps[0]!.target;
  const until = Date.now() + patience;
  while (Date.now() < until && (otherDialogOpen() || !findTarget(first))) await wait(100);
  // The tour starts at its first control (Today's board, the register): on another page it
  // waits for a visit to that one, rather than showing the rest and calling it seen.
  if (otherDialogOpen() || !findTarget(first)) return null;
  const steps = plan.steps.filter((s) => findTarget(s.target) !== null);
  return { ...plan, steps };
}

/**
 * The guided tour (coach marks), the website's copy of the app's (apps/mobile/src/tour): it
 * dims the page, cuts a lit hole around one control at a time and explains it in a card. The
 * first time someone signs in here it walks through everything; after an update, only what
 * that release added or changed (steps.ts). "Take the tour again" replays it.
 *
 * `enabled` is false while a developer is viewing as someone: nothing runs or is stored.
 */
export function Tour({
  userId,
  audience,
  current,
  enabled,
}: {
  userId: string;
  audience: Audience;
  /** The site's version (CURRENT.version), passed in so the changelog stays on the server. */
  current: string;
  enabled: boolean;
}): ReactNode {
  const [plan, setPlan] = useState<TourPlan | null>(null);
  const [status, setStatus] = useState<Status>("checking");
  const busy = useRef(false);
  // The layout stays mounted between pages: check again on each one (the tour waits for its
  // first control's page).
  const path = usePathname();

  const markSeen = useCallback(
    () => writeSeen(browserStorage(), userId, current),
    [userId, current],
  );

  // First visit or an update: decide once the page has settled.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(async () => {
      const storage = browserStorage();
      if (!tourAllowed(storage, navigator.webdriver === true) || busy.current) {
        if (live && !busy.current) setStatus("none");
        return;
      }
      const wanted = planTour({ seen: readSeen(storage, userId, current), current, audience });
      if (!wanted) {
        if (live) setStatus("none");
        return;
      }
      busy.current = true;
      const shown = await onPage(wanted, 1500);
      if (!live) {
        busy.current = false;
        return;
      }
      if (shown) {
        setPlan(shown);
        setStatus("open");
      } else {
        busy.current = false;
        // Nothing to point at here: try again on the next page, unless it's a dialog in the way.
        setStatus("none");
      }
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, userId, audience, current, path]);

  // Take the tour again: the button navigates to the tour's page; run it once its controls show.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const replay = async (): Promise<void> => {
      if (busy.current || !takeReplay()) return;
      busy.current = true;
      const wanted = planTour({ seen: null, current, audience, replay: true });
      const shown = wanted ? await onPage(wanted, FIND_MS) : null;
      if (live && shown) {
        setPlan(shown);
        setStatus("open");
      } else busy.current = false;
    };
    const off = onReplay(() => void replay());
    void replay(); // asked for on another page, before this tour mounted
    return () => {
      live = false;
      off();
    };
  }, [enabled, audience, current]);

  const finish = useCallback(() => {
    markSeen();
    busy.current = false;
    setPlan(null);
    setStatus("done");
  }, [markSeen]);

  return (
    <>
      {/* For tests: what the tour decided (checking, none, open, done). */}
      <span hidden data-tour-status={enabled ? status : "off"} />
      {plan && enabled ? (
        <TourDialog
          key={plan.steps.map((s) => s.id).join()}
          plan={plan}
          current={current}
          onClosing={markSeen}
          onFinish={finish}
        />
      ) : null}
    </>
  );
}

function TourDialog({
  plan,
  current,
  onClosing,
  onFinish,
}: {
  plan: TourPlan;
  current: string;
  /** Runs the moment the tour starts closing: someone leaving mid-animation has still seen it. */
  onClosing: () => void;
  onFinish: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  /** Set once the tour is on its way out, so it finishes exactly once. */
  const ended = useRef(false);
  const [index, setIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const [hole, setHole] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [cardHeight, setCardHeight] = useState(0);
  const titleId = useId();
  const bodyId = useId();
  const step = plan.steps[index]!;
  const last = index === plan.steps.length - 1;
  const text = stepText(step, plan.kind);

  // Open as a modal: the page behind is inert, focus moves in (to Next) and stays in.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const previous = document.activeElement;
    if (!el.open) el.showModal();
    return () => {
      // Focus goes back where it was, if that control is still on the page.
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  // Each step: bring its control into view, then keep the hole on it while the page moves.
  useEffect(() => {
    const target = findTarget(step.target);
    target?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = findTarget(step.target);
        const size = { width: window.innerWidth, height: window.innerHeight };
        setViewport((v) => (v.width === size.width && v.height === size.height ? v : size));
        const next = el ? holeFor(el.getBoundingClientRect(), size) : null;
        setHole((h) =>
          h &&
          next &&
          h.x === next.x &&
          h.y === next.y &&
          h.width === next.width &&
          h.height === next.height
            ? h
            : next,
        );
      });
    };
    measure();
    // Smooth scrolling and pages that refresh themselves (the register) move things around.
    const poll = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(poll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
    };
  }, [step.target]);

  // The card's height decides whether it fits under the hole.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCardHeight(Math.round(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const close = (): void => {
    if (ended.current) return;
    ended.current = true;
    onClosing();
    setClosing(true);
    window.setTimeout(
      () => {
        dialog.current?.close();
        onFinish();
      },
      reducedMotion() ? 0 : CLOSE_MS,
    );
  };

  const next = (): void => {
    if (last) close();
    else setIndex((i) => Math.min(plan.steps.length - 1, i + 1));
  };

  // Tab and Shift+Tab cycle through the card's buttons only.
  const trapTab = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const lastButton = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      first.focus();
    }
  };

  const ready = viewport.height > 0 && cardHeight > 0;

  // Focus moves onto Next once the card is shown: focus() on the still-hidden card (it waits
  // for its measured place) does nothing, and the browser would leave focus on the dialog.
  const focusedIn = useRef(false);
  useEffect(() => {
    if (!ready || focusedIn.current) return;
    focusedIn.current = true;
    dialog.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus();
  }, [ready]);
  const top = placeCardTop({ hole, viewportHeight: viewport.height, cardHeight });
  const { left, width } = placeCardX({ hole, viewportWidth: viewport.width });
  const placement = !hole
    ? "center"
    : top >= hole.y + hole.height
      ? "below"
      : top + cardHeight <= hole.y
        ? "above"
        : "over";

  return (
    <dialog
      ref={dialog}
      data-tour-dialog=""
      data-state={closing ? "closing" : "open"}
      data-step={step.id}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="tour-dialog"
      onKeyDown={trapTab}
      onCancel={(event) => {
        // Escape: skip the tour (the close runs through React, so it's stored as seen).
        event.preventDefault();
        close();
      }}
      onClose={() => {
        // The browser closed it on its own (a second Escape): still finish properly.
        if (ended.current) return;
        ended.current = true;
        onFinish();
      }}
    >
      {hole ? (
        <div
          className="tour-hole"
          aria-hidden="true"
          style={{
            left: hole.x,
            top: hole.y,
            width: hole.width,
            height: hole.height,
            borderRadius: holeRadius(hole),
          }}
        />
      ) : (
        <div className="tour-scrim" aria-hidden="true" />
      )}

      <div
        ref={card}
        data-placement={placement}
        className="tour-card flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)]"
        style={{ top, left, width, visibility: ready ? "visible" : "hidden" }}
      >
        <div className="flex items-center gap-2 text-sm">
          <p className="flex-1 font-bold text-accent">{tourLabel(plan.kind, current)}</p>
          <p className="tabular-nums text-muted">
            {index + 1} of {plan.steps.length}
          </p>
        </div>
        <div key={step.id} className="tour-step-text flex flex-col gap-1.5">
          <h2 id={titleId} className="font-display text-xl text-ink">
            {step.title}
          </h2>
          <p id={bodyId} className="text-muted">
            {text}
          </p>
        </div>
        <div aria-hidden="true" className="flex gap-1.5">
          {plan.steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1 rounded-full ${i === index ? "flex-[2]" : "flex-1"} ${
                i <= index ? "bg-accent" : "bg-line"
              }`}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={close}
            aria-label={last ? "Close the tour" : "Skip the tour"}
            className="min-h-11 rounded-control px-3 font-bold text-accent underline-offset-4 hover:underline"
          >
            {last ? "Close" : "Skip"}
          </button>
          <span className="flex-1" />
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="press min-h-11 rounded-control bg-surface px-4 font-bold text-accent ring-1 ring-line hover:ring-accent/40"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            data-tour-primary=""
            onClick={next}
            className="press min-h-11 rounded-control bg-accent px-5 font-bold text-on-accent shadow-[0_2px_0_rgba(0,0,0,0.12)] hover:brightness-105"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
        {/* Each step is announced as it arrives; the first comes with the dialog's own name. */}
        <p aria-live="polite" className="sr-only">
          {index > 0 ? `${index + 1} of ${plan.steps.length}. ${step.title}. ${text}` : ""}
        </p>
      </div>
    </dialog>
  );
}
