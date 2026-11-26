import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { callBackend } from "@/lib/backend";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  COOKIE_BASE,
  isGuestCookie,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from "@/lib/cookies";
import { FILTERS_COOKIE, parseFilters, type Remembered } from "@/lib/filters";
import { whoIsSignedIn, type Found } from "@/lib/me";
import { isAdminRole, type TokenPair, type User, type ViewRole } from "@/lib/types";
import { canViewAs, VIEW_AS_COOKIE, viewingAsOf, viewRole, type EndTarget } from "@/lib/view-as";

/** Store a fresh token pair. Only valid inside Server Actions and Route Handlers. */
export async function storeTokens(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.access_token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  jar.set(REFRESH_COOKIE, tokens.refresh_token, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  // A fresh sign-in (only sign-in and password reset call this; refresh is in proxy.ts) starts
  // as that person: a view left by a developer on this browser never carries over. Nor do the
  // office's remembered filters: they belong to whoever chose them.
  jar.delete(VIEW_AS_COOKIE);
  jar.delete(FILTERS_COOKIE);
}

/**
 * Sign-out and account deletion: the login, and every guest pass this browser holds, so a
 * verified safe-return or code-joined pass doesn't linger on a shared computer.
 */
export async function clearTokens(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(VIEW_AS_COOKIE);
  jar.delete(FILTERS_COOKIE);
  for (const { name } of jar.getAll()) if (isGuestCookie(name)) jar.delete(name);
}

export async function accessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function refreshToken(): Promise<string | null> {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}

/** The office's remembered list filters (lib/filters.ts); anything malformed is ignored. */
export async function rememberedFilters(): Promise<Remembered> {
  return parseFilters((await cookies()).get(FILTERS_COOKIE)?.value);
}

/** The role this browser views the site as (a well-formed cookie), or null. */
export async function viewingAs(): Promise<ViewRole | null> {
  return viewRole((await cookies()).get(VIEW_AS_COOKIE)?.value);
}

/**
 * Who /auth/me says is signed in (lib/me.ts), asked once per request: the layout and the page
 * both need it. React.cache keeps the answer for one server render only, never across requests,
 * so an account turned off or demoted loses access on its very next request. A Server Action's
 * own body isn't memoized at all, and the render after it (sign-in, sign-out, View as) starts
 * empty. Keyed by the token and the view-as role as well, so a changed cookie is asked again.
 */
const lookUp = cache((token: string, viewing: ViewRole | null): Promise<Found | null> =>
  whoIsSignedIn((asSelf) => callBackend<User>("/auth/me", { token, asSelf }), viewing),
);

async function me(token: string): Promise<Found | null> {
  return lookUp(token, await viewingAs());
}

/** The signed-in student, or null. Never throws for auth failures. */
export async function currentUser(): Promise<User | null> {
  const token = await accessToken();
  if (!token) return null;
  return (await me(token))?.user ?? null;
}

export interface Session {
  user: User;
  token: string;
  /** The role a developer is viewing the site as (read-only; `user.role` equals it), else null. */
  viewingAs: ViewRole | null;
  /** The real person is a developer: the View as menu is theirs. */
  developer: boolean;
}

/**
 * For protected pages: the student, or a redirect to sign in. A view the API no longer
 * honours is cleared first (view-as/end), landing on `home`.
 */
export async function requireUser(home: EndTarget = "/home"): Promise<Session> {
  const token = await accessToken();
  const found = token ? await me(token) : null;
  if (!found || !token) redirect("/sign-in");
  if (found.stale) redirect(`/view-as/end?to=${encodeURIComponent(home)}`);
  const viewing = viewingAsOf(found.user);
  return {
    user: found.user,
    token,
    viewingAs: viewing,
    developer: canViewAs(found.user.role, viewing),
  };
}

/** For the hostel office's daily pages: admins and wardens. Students get a plain 404, so the
 * area's existence isn't advertised; a warden's data is limited to their hostels by the API. */
export async function requireStaff(): Promise<Session> {
  const session = await requireUser("/admin");
  if (session.user.role === "student") notFound();
  return session;
}

/** For the outing rules, holidays and hostels: admins (and developers) and head wardens. */
export async function requireRulesEditor(): Promise<Session> {
  const session = await requireUser("/admin");
  if (!isAdminRole(session.user.role) && session.user.role !== "head_warden") notFound();
  return session;
}

/** For the developer's own pages (Status): a developer as themselves. Everyone else, and a
 * developer viewing as a role (`role` is then that role), gets a plain 404. */
export async function requireDeveloper(): Promise<Session> {
  const session = await requireUser("/admin");
  if (session.user.role !== "developer" || session.viewingAs !== null) notFound();
  return session;
}

/** For campus-wide setup (gates, people, settings): admins and developers only. While a
 * developer views as a warden, `role` is "warden", so these pages are a 404 then too. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser("/admin");
  if (!isAdminRole(session.user.role)) notFound();
  return session;
}
