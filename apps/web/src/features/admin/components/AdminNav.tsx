"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type FocusEvent, type ReactNode } from "react";

import { POSTER_ROLES } from "@/features/board/board";
import { ViewAsMenu } from "@/features/developer/components/ViewAsMenu";
import type { TargetId } from "@/features/tour/steps";
import type { Role } from "@/lib/types";

interface Section {
  href: string;
  label: string;
  /** Who sees it: the daily pages are for everyone in the office, setup for admins (and
   * developers, who have every admin power). */
  for: readonly Role[] | "staff";
  /** What the guided tour calls it (features/tour/steps.ts). */
  tour?: TargetId;
}

const SECTIONS: readonly Section[] = [
  { href: "/admin", label: "Register", for: "staff" },
  { href: "/admin/requests", label: "Requests", for: "staff", tour: "nav-requests" },
  { href: "/admin/corrections", label: "Corrections", for: "staff", tour: "nav-corrections" },
  { href: "/admin/escalations", label: "Escalations", for: "staff", tour: "nav-escalations" },
  { href: "/admin/scans", label: "Scans", for: "staff" },
  // Posts every student in a hostel sees; never a developer (they don't post to it).
  { href: "/admin/board", label: "Hostel board", for: POSTER_ROLES },
  { href: "/admin/hostel", label: "My hostel", for: ["warden"] },
  { href: "/admin/gates", label: "Gates", for: ["admin", "developer"] },
  { href: "/admin/rules", label: "Rules", for: ["admin", "head_warden", "developer"] },
  // Wardens see their own hostels' students there (details, turning an account off).
  { href: "/admin/people", label: "People", for: "staff", tour: "nav-people" },
  // Counts per hostel over a range of dates; a warden's own hostels only.
  { href: "/admin/reports", label: "Reports", for: "staff" },
  { href: "/admin/settings", label: "Settings", for: ["admin", "developer"] },
  // Read only: every change made in the office.
  { href: "/admin/audit", label: "Audit log", for: ["admin", "developer"] },
  // Which builds are running (a developer as themselves; while viewing, `role` is the viewed one).
  { href: "/admin/status", label: "Status", for: ["developer"] },
  // What broke on the website and in the app (scrubbed, grouped).
  { href: "/admin/errors", label: "Errors", for: ["developer"] },
];

/** How far an edge of the phone row fades out where more tabs are hidden past it. */
const FADE = "16px";

/** Sets the fade at each end of the row from where it is scrolled: only an end that hides tabs
 * fades (CSS custom properties the list's mask reads; nothing re-renders). */
function setFades(ul: HTMLElement): void {
  const hidden = ul.scrollWidth - ul.clientWidth;
  ul.style.setProperty("--fade-start", ul.scrollLeft > 1 ? FADE : "0px");
  ul.style.setProperty("--fade-end", ul.scrollLeft < hidden - 1 ? FADE : "0px");
}

/** Section tabs. On a phone they are one row that scrolls sideways inside itself (owner,
 * 2026-11-26: three wrapped rows took ~170 px above every page), with the current section
 * scrolled into view on each page; an edge that hides more tabs fades out, so the row reads as
 * scrollable wherever the tabs happen to break. From sm up they wrap, every section in view. A
 * developer also gets the View as menu at the row's end (on a phone, beside the scroller). */
export function AdminNav({ role, viewAs = false }: { role: Role; viewAs?: boolean }): ReactNode {
  const path = usePathname();
  const list = useRef<HTMLUListElement>(null);
  const sections = SECTIONS.filter((s) => s.for === "staff" || s.for.includes(role));

  useEffect(() => {
    const ul = list.current;
    const current = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (ul && current) {
      // The list's own scroll only (scrollIntoView could also move the page); centred, so the
      // tabs either side show too. A no-op when the row isn't scrolling (wide screens).
      const left = current.offsetLeft - (ul.clientWidth - current.offsetWidth) / 2;
      ul.scrollLeft = Math.max(0, left);
    }
    if (ul) {
      setFades(ul);
      // Tells tests the row has settled (not React state: nothing renders differently).
      ul.dataset.scrolled = "true";
    }
  }, [path]);

  // The fades follow the row's own scrolling and the screen's width.
  useEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const update = (): void => setFades(ul);
    ul.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      ul.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Tabbing to a tab that is only partly showing leaves it there (the browser scrolls a focus
  // into view only when none of it is). Bring it whole into view with the row's own side
  // padding to spare, so the focus ring isn't cut by the scroller either. Keyboard focus only:
  // moving the row under a pressing finger or mouse would lose the click.
  function showFocused(event: FocusEvent<HTMLUListElement>): void {
    const ul = list.current;
    const link = event.target;
    if (!ul || link === ul || !(link instanceof HTMLElement) || !link.matches(":focus-visible")) {
      return;
    }
    // The row's side padding plus the fade, so neither covers the link or its ring.
    const room = 24;
    const start = link.offsetLeft - room;
    const end = link.offsetLeft + link.offsetWidth + room;
    if (start < ul.scrollLeft) ul.scrollLeft = Math.max(0, start);
    else if (end > ul.scrollLeft + ul.clientWidth) ul.scrollLeft = end - ul.clientWidth;
  }

  // On a phone the row runs to the screen's edges; with View as, only to the left one: the
  // menu sits after the row on the same line, outside the scroller (which, with its fade,
  // would clip the menu that drops below the button).
  const phoneWidth = viewAs
    ? "-ml-4 pl-4 pr-1.5 max-sm:min-w-0 max-sm:flex-1"
    : "-mx-4 w-[calc(100%+2rem)] px-4";
  return (
    <nav
      aria-label="Hostel office"
      className="flex items-center gap-2 sm:flex-wrap sm:items-start sm:gap-1"
    >
      {/* py-1.5: the focus ring (3 px + 3 px offset) is 6 px, and a scroller clips what is outside it. */}
      {/* tabIndex -1: Firefox makes a scrolling box a tab stop of its own even with links in it,
          and the edge mask hid its ring; the links already reach (and scroll) every tab. */}
      <ul
        ref={list}
        tabIndex={-1}
        onFocus={showFocused}
        className={`relative flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,transparent,#000_var(--fade-start),#000_calc(100%_-_var(--fade-end)),transparent)] ${phoneWidth} sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:p-0`}
      >
        {sections.map((section) => {
          const current =
            section.href === "/admin" ? path === "/admin" : path.startsWith(section.href);
          return (
            <li key={section.href} className="shrink-0">
              <Link
                href={section.href}
                data-tour={section.tour}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-control px-3 text-sm font-bold transition sm:px-3.5 ${
                  current ? "bg-ink text-page" : "text-muted hover:bg-accent-soft hover:text-ink"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {viewAs ? (
        <div className="ml-auto shrink-0">
          <ViewAsMenu current={null} />
        </div>
      ) : null}
    </nav>
  );
}
