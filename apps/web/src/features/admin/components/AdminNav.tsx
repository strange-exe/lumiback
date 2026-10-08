"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const SECTIONS = [
  { href: "/admin", label: "Register" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/escalations", label: "Escalations" },
  { href: "/admin/scans", label: "Scans" },
  { href: "/admin/gates", label: "Gates" },
  { href: "/admin/rules", label: "Rules" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/settings", label: "Settings" },
] as const;

/** Section tabs; scrolls sideways on a phone rather than wrapping into two rows. */
export function AdminNav(): ReactNode {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {SECTIONS.map((section) => {
          const current =
            section.href === "/admin" ? path === "/admin" : path.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-control px-3.5 text-sm font-bold transition ${
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
