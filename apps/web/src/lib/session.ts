import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError, callBackend } from "@/lib/backend";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  COOKIE_BASE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from "@/lib/cookies";
import type { TokenPair, User } from "@/lib/types";

/** Store a fresh token pair. Only valid inside Server Actions and Route Handlers. */
export async function storeTokens(tokens: TokenPair): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.access_token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  jar.set(REFRESH_COOKIE, tokens.refresh_token, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
}

export async function clearTokens(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function accessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function refreshToken(): Promise<string | null> {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}

/** The signed-in student, or null. Never throws for auth failures. */
export async function currentUser(): Promise<User | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    return await callBackend<User>("/auth/me", { token });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

/** For protected pages: the student, or a redirect to sign in. */
export async function requireUser(): Promise<{ user: User; token: string }> {
  const token = await accessToken();
  const user = token ? await currentUser() : null;
  if (!user || !token) redirect("/");
  return { user, token };
}
