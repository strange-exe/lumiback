/**
 * People's role chips (admins and developers only; owner D1, 2026-11-09): list one role's
 * people, with or without a search. Wardens and head wardens get no chips, and the API ignores
 * a role from them anyway. Pure, so `node --test` can load it.
 */

import { pageHref } from "../../lib/filters.ts";
import { isUuid } from "../../lib/ids.ts";

export type ChipRole = "student" | "warden" | "head_warden" | "admin" | "developer";

export const ROLE_CHIPS: readonly { value: ChipRole | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "student", label: "Students" },
  { value: "warden", label: "Wardens" },
  { value: "head_warden", label: "Head wardens" },
  { value: "admin", label: "Admins" },
  { value: "developer", label: "Developers" },
];

/**
 * The line above the list: how many are shown on this page. Every list pages, so none is ever
 * cut: a "More people" link follows the rows when more remain.
 */
export function resultCount(shown: number): string {
  if (shown === 0) return "No one shown.";
  return `${shown} ${shown === 1 ? "person" : "people"} shown.`;
}

/** Every People list (the office list, a search, a role chip) is shown this many at a time. */
export const PEOPLE_PAGE = 50;

/** The list a People row's form came from, sent back with it (hidden fields). */
export interface BackTo {
  q: string;
  account: string;
  hostel: string;
  role: string;
  after: string;
}

/**
 * Where cancelling an invite returns: the same list (its filters, search, role chip and page)
 * with the "cancelled" note. Every value is checked and anything else dropped, so the address
 * only ever leads to People. The page's own cursor is someone on an earlier page, never the
 * row just removed, so the same page comes back.
 */
export function afterCancelHref(back: BackTo): string {
  const list = pageHref(
    "people",
    { hostel: back.hostel, account: back.account },
    { q: back.q.slice(0, 100), role: back.role },
  );
  const query = new URLSearchParams(list.split("?")[1] ?? "");
  if (isUuid(back.after)) query.set("after", back.after);
  query.set("cancelled", "1");
  return `/admin/people?${query.toString()}`;
}

/**
 * One page from an answer asked for with `limit` = size + 1: the rows to show, and the id the
 * next page starts after (null: nobody follows, so no "More people" link to an empty page).
 */
export function onePage<T extends { id: string }>(
  answer: readonly T[],
  size: number = PEOPLE_PAGE,
): { rows: T[]; next: string | null } {
  const rows = answer.slice(0, size);
  const last = rows.at(-1);
  return { rows, next: answer.length > size && last ? last.id : null };
}

/**
 * Which list answers. "search" (GET /admin/users, admins only): knows roles and a warden's
 * hostels, so the role form works. "students" (GET /admin/students): the office list, with phone
 * numbers, the account and hostel filters, and the student chip.
 */
export function listSource({
  isAdmin,
  search,
  role,
  account,
  hostel,
}: {
  isAdmin: boolean;
  search: string | undefined;
  role: ChipRole | undefined;
  account: string | undefined;
  hostel: string | undefined;
}): "search" | "students" {
  if (!isAdmin || account || hostel || role === "student") return "students";
  return search || role ? "search" : "students";
}
