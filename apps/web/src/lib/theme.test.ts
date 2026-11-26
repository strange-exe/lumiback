import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_THEME,
  parseTheme,
  THEME_COOKIE,
  THEME_MAX_AGE,
  themeColor,
  themeCookieOptions,
  THEMES,
} from "./theme.ts";

test("Gate glass is the default, first in the list", () => {
  assert.equal(DEFAULT_THEME, "gate");
  assert.deepEqual(
    THEMES.map((t) => t.id),
    ["gate", "led", "dusk"],
  );
  assert.deepEqual(
    THEMES.map((t) => t.name),
    ["Gate glass", "LED night", "Dusk"],
  );
  for (const t of THEMES) assert.ok(t.line.length > 0, `${t.id} has a one-line description`);
});

test("a stored theme is read back; anything else falls back to Gate glass", () => {
  assert.equal(parseTheme("gate"), "gate");
  assert.equal(parseTheme("led"), "led");
  assert.equal(parseTheme("dusk"), "dusk");
  for (const bad of [
    undefined,
    null,
    "",
    "Dusk",
    "LED",
    " dusk",
    "neon",
    "constructor",
    "__proto__",
  ]) {
    assert.equal(parseTheme(bad), "gate", `${String(bad)} -> gate`);
  }
});

test("the theme cookie lasts a year and is httpOnly, Lax, Secure in production", () => {
  assert.equal(THEME_COOKIE, "lumiback_theme");
  assert.equal(THEME_MAX_AGE, 365 * 24 * 60 * 60);
  assert.deepEqual(themeCookieOptions("production"), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: THEME_MAX_AGE,
  });
  assert.equal(themeCookieOptions("development").secure, false);
});

test("the browser bar takes the theme's page colour, light and dark", () => {
  assert.deepEqual(themeColor("dusk", "page"), [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f16" },
  ]);
  assert.deepEqual(themeColor("gate", "board"), [
    { media: "(prefers-color-scheme: light)", color: "#e2ece9" },
    { media: "(prefers-color-scheme: dark)", color: "#051417" },
  ]);
});

test("each theme's line matches the app's word for word (owner, 2026-11-26)", () => {
  // The same three lines sit in apps/mobile/src/app/(app)/profile/appearance.tsx, pinned by
  // screens/appearance.test.ts. "Warm paper" once named Gate in the app and Dusk here.
  assert.deepEqual(
    THEMES.map((t) => [t.id, t.line]),
    [
      ["gate", "Calm paper and dark ink, teal when you're out"],
      ["led", "Graphite and signal orange, like a station's LED board"],
      ["dusk", "Soft paper with orchid and indigo"],
    ],
  );
});
