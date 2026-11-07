/**
 * A developer's read-only "View as" a ROLE (contract: .claude/tasks/view-as-contract.md). The
 * browser holds the chosen role in an httpOnly cookie; the website's own calls to the API add
 * it as the X-View-As-Role header. The API decides everything: it honours the header only for a
 * real developer, runs the request as the developer (their own data), reports the viewed role
 * from /auth/me and refuses every change. Pure (no Next.js imports), so `node --test` can load it.
 */

import type { Role, ViewRole } from "./types.ts";

export const VIEW_AS_COOKIE = "lb_view_as_role";
export const VIEW_AS_HEADER = "X-View-As-Role";
/** A view ends by itself after a working morning or afternoon. */
export const VIEW_AS_MAX_AGE = 4 * 60 * 60;

/** The roles a developer can view as, in the menu's order (after Developer itself). */
export const VIEW_ROLES: readonly ViewRole[] = ["admin", "head_warden", "warden", "student"];

/** One menu choice: a role to view as, or "developer" (yourself, not viewing). */
export type ViewChoice = "developer" | ViewRole;
export const VIEW_CHOICES: readonly ViewChoice[] = ["developer", ...VIEW_ROLES];

/** The API's details (backend contract), compared exactly. */
export const DEVELOPERS_ONLY = "View as is for developers only";
export const UNKNOWN_ROLE = "Unknown role to view as";
export const READ_ONLY = "Read-only while viewing as another role";

/**
 * The role in the cookie, only if it's exactly one of the four (anything else, including
 * "developer", other casing or padding, is ignored and never sent).
 */
export function viewRole(value: string | null | undefined): ViewRole | null {
  return VIEW_ROLES.find((role) => role === value) ?? null;
}

/** A choice posted by the menu, or null for anything that isn't one of the five. */
export function viewChoice(value: unknown): ViewChoice | null {
  return VIEW_CHOICES.find((choice) => choice === value) ?? null;
}

/** /auth/me's `viewing_as`, read defensively (an older API sends nothing). */
export function viewingAsOf(user: { viewing_as?: unknown }): ViewRole | null {
  return typeof user.viewing_as === "string" ? viewRole(user.viewing_as) : null;
}

/**
 * The extra request headers for one API call. Only calls made as the signed-in person (with
 * their token) carry it, and never when the caller asks to act as itself.
 */
export function viewAsHeaders({
  token,
  cookie,
  asSelf = false,
}: {
  token: string | null | undefined;
  cookie: string | null | undefined;
  asSelf?: boolean;
}): Record<string, string> {
  if (asSelf || !token) return {};
  const role = viewRole(cookie);
  return role ? { [VIEW_AS_HEADER]: role } : {};
}

/**
 * The API's answer means this browser's view is no good: the signed-in person isn't a
 * developer (any more), or the role wasn't understood. The cookie is then cleared.
 */
export function endsViewAs(status: number, detail: string): boolean {
  return (
    (status === 403 && detail === DEVELOPERS_ONLY) || (status === 400 && detail === UNKNOWN_ROLE)
  );
}

/** The real person behind a session can use View as: a developer, or one viewing now. */
export function canViewAs(role: Role, viewingAs: ViewRole | null): boolean {
  return viewingAs !== null || role === "developer";
}

/** Where a choice lands: a student's Today, or the hostel office for everyone else. */
export function homeFor(choice: ViewChoice): "/home" | "/admin" {
  return choice === "student" ? "/home" : "/admin";
}

/** Where a stale view goes once its cookie is cleared (view-as/end/route.ts). */
export const END_TARGETS = ["/home", "/admin"] as const;
export type EndTarget = (typeof END_TARGETS)[number];

export function endTarget(value: string | null | undefined): EndTarget {
  return END_TARGETS.find((t) => t === value) ?? "/home";
}
