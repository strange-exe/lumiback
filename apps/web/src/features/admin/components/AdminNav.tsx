"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
  { href: "/admin/hostel", label: "My hostel", for: ["warden"] },
  { href: "/admin/gates", label: "Gates", for: ["admin", "developer"] },
  { href: "/admin/rules", label: "Rules", for: ["admin", "head_warden", "developer"] },
  // Wardens see their own hostels' students there (details, turning an account off).
  { href: "/admin/people", label: "People", for: "staff", tour: "nav-people" },
  { href: "/admin/settings", label: "Settings", for: ["admin", "developer"] },
  // Which builds are running (a developer as themselves; while viewing, `role` is the viewed one).
  { href: "/admin/status", label: "Status", for: ["developer"] },
];

/** Section tabs. They wrap onto a second row on a phone, so every section and the current
 * one stay in view (a sideways-scrolling strip hid half of them). A developer also gets the
 * View as menu at the row's end. */
export function AdminNav({ role, viewAs = false }: { role: Role; viewAs?: boolean }): ReactNode {
  const path = usePathname();
  const sections = SECTIONS.filter((s) => s.for === "staff" || s.for.includes(role));
  return (
    <nav aria-label="Hostel office" className="flex flex-wrap items-start gap-1">
      <ul className="flex flex-wrap gap-1">
        {sections.map((section) => {
          const current =
            section.href === "/admin" ? path === "/admin" : path.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                data-tour={section.tour}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-control px-3 text-sm font-bold transition sm:px-3.5 ${
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
        <div className="ml-auto">
          <ViewAsMenu current={null} />
        </div>
      ) : null}
    </nav>
  );
}
