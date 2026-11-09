/**
 * People's role chips (admins and developers only; owner D1, 2026-11-09): list one role's
 * people, with or without a search. Wardens and head wardens get no chips, and the API ignores
 * a role from them anyway. Pure, so `node --test` can load it.
 */

export type ChipRole = "student" | "warden" | "head_warden" | "admin" | "developer";

export const ROLE_CHIPS: readonly { value: ChipRole | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "student", label: "Students" },
  { value: "warden", label: "Wardens" },
  { value: "head_warden", label: "Head wardens" },
  { value: "admin", label: "Admins" },
  { value: "developer", label: "Developers" },
];

/** The line above the list: how many are shown, and whether the list was cut at `cap`. */
export function resultCount(shown: number, cap: number): string {
  if (shown >= cap) return `The first ${cap} shown. Search to narrow it down.`;
  if (shown === 0) return "No one shown.";
  return `${shown} ${shown === 1 ? "person" : "people"} shown.`;
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
