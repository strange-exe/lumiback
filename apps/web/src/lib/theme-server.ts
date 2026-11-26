import "server-only";

import { cookies } from "next/headers";

import { parseTheme, THEME_COOKIE, type ThemeName } from "@/lib/theme";

/** This browser's colour theme (Gate glass unless it chose another), read from its cookie. */
export async function currentTheme(): Promise<ThemeName> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
