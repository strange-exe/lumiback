"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { Role } from "@/lib/types";

interface Section {
  href: string;
  label: string;
  /** Who sees it: the daily pages are for everyone in the office, setup for admins. */
  for: "staff" | "admin" | "warden";
}

const SECTIONS: readonly Section[] = [
  { href: "/admin", label: "Register", for: "staff" },
  { href: "/admin/requests", label: "Requests", for: "staff" },
  { href: "/admin/escalations", label: "Escalations", for: "staff" },
  { href: "/admin/scans", label: "Scans", for: "staff" },
  { href: "/admin/hostel", label: "My hostel", for: "warden" },
  { href: "/admin/gates", label: "Gates", for: "admin" },
  { href: "/admin/rules", label: "Rules", for: "admin" },
  { href: "/admin/people", label: "People", for: "admin" },
  { href: "/admin/settings", label: "Settings", for: "admin" },
];

/** Section tabs. They wrap onto a second row on a phone, so every section and the current
 * one stay in view (a sideways-scrolling strip hid half of them). */
export function AdminNav({ role }: { role: Role }): ReactNode {
  const path = usePathname();
  const sections = SECTIONS.filter((s) => s.for === "staff" || s.for === role);
  return (
    <nav aria-label="Hostel office">
      <ul className="flex flex-wrap gap-1">
        {sections.map((section) => {
          const current =
            section.href === "/admin" ? path === "/admin" : path.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
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
    </nav>
  );
}
