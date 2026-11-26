import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { ADMIN_STATE } from "../playwright.config";
import { THEME_COOKIE, THEME_MAX_AGE, themeColor, type ThemeName } from "../src/lib/theme";

import { checkOut, ensureIn, watchForErrors } from "./helpers";

/**
 * Colour themes on the web (owner's pick, 2026-11-25): Gate glass by default, LED night and Dusk
 * from Account. The choice is a cookie the server reads, so the first paint is already themed.
 */

async function useTheme(context: BrowserContext, theme: string): Promise<void> {
  await context.addCookies([{ name: THEME_COOKIE, value: theme, url: "http://localhost:3000" }]);
}

/** The theme on <html>, and that its colours really apply (the page's --page). */
async function expectTheme(page: Page, theme: ThemeName, scheme: "light" | "dark"): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const want = themeColor(theme, "page").find((c) => c.media.includes(scheme))!.color;
  const page_ = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
  );
  expect(page_, `${theme}/${scheme} --page`).toBe(want);
}

test("a student picks Dusk on Account and it stays after a reload", async ({
  page,
  context,
  browserName,
}) => {
  const errors = watchForErrors(page);
  await page.goto("/account");
  await expectTheme(page, "gate", "light");
  const group = page.getByRole("group", { name: "Colour theme" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { name: /^Gate glass/ })).toBeChecked();

  await group.getByRole("radio", { name: /^Dusk/ }).check();
  await page.getByRole("button", { name: "Use this theme" }).click();
  await expect(page.getByText("Saved. This browser uses it from now on.")).toBeVisible();
  // The action re-renders the root layout: the page changes without a reload.
  await expectTheme(page, "dusk", "light");
  await expect(group.getByRole("radio", { name: /^Dusk/ })).toBeChecked();

  const cookie = (await context.cookies()).find((c) => c.name === THEME_COOKIE);
  expect(cookie).toMatchObject({ value: "dusk", httpOnly: true, path: "/" });
  // Playwright's WebKit on Windows reports every cookie as SameSite=None, the session cookies
  // (set Lax by the same helper) included. The attribute itself is pinned in src/lib/theme.test.ts.
  if (browserName !== "webkit") expect(cookie!.sameSite).toBe("Lax");
  const lifetime = cookie!.expires - Date.now() / 1000;
  expect(lifetime).toBeGreaterThan(THEME_MAX_AGE - 120);
  expect(lifetime).toBeLessThanOrEqual(THEME_MAX_AGE + 5);

  await page.reload();
  await expectTheme(page, "dusk", "light");
  await page.goto("/home");
  await expectTheme(page, "dusk", "light");
  expect(errors).toEqual([]);
});

// Owner, 2026-11-26: at 320 px the swatch sits under the theme's words, so each line keeps the
// row's width (beside the swatch it wrapped onto four lines); from sm up the swatch leads.
for (const [width, stacked] of [
  [320, true],
  [1440, false],
] as const) {
  test(`the picker's swatches ${stacked ? "stack under" : "lead"} the names at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/account");
    const rows = page.locator("[data-picker-body]");
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      const swatch = (await row.locator("[data-theme]").boundingBox())!;
      const name = (await row.locator("span.font-bold").boundingBox())!;
      const line = row.locator("span.text-sm");
      if (stacked) {
        expect(swatch.y).toBeGreaterThanOrEqual(name.y + name.height);
        // Two lines at most (20 px line height at text-sm).
        expect((await line.boundingBox())!.height).toBeLessThanOrEqual(41);
      } else {
        expect(swatch.x + swatch.width).toBeLessThanOrEqual(name.x);
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
  });
}

test("an unknown stored theme falls back to Gate glass", async ({ page, context }) => {
  await useTheme(context, "neon");
  await page.goto("/account");
  await expectTheme(page, "gate", "light");
  await expect(page.getByRole("radio", { name: /^Gate glass/ })).toBeChecked();
});

test("the browser bar follows the theme", async ({ page, context }) => {
  await useTheme(context, "led");
  await page.goto("/home");
  const bars = page.locator('meta[name="theme-color"]');
  await expect(bars).toHaveCount(2);
  expect(await bars.evaluateAll((m) => m.map((e) => e.getAttribute("content")))).toEqual(
    themeColor("led", "page").map((c) => c.color),
  );
});

test("hostel office staff reach the picker from My app", async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto("/admin");
  await page.getByRole("link", { name: "My app" }).click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByRole("group", { name: "Colour theme" })).toBeVisible();
  await context.close();
});

test("the decorative glow behind the board shows in LED night only", async ({ page, context }) => {
  await checkOut(page, "Library");
  const fx = page.locator(".led-stage-fx").first();
  const glow = () => fx.evaluate((el) => getComputedStyle(el, "::before").content);
  expect(await glow()).toBe("none");
  await useTheme(context, "led");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "led");
  expect(await glow()).not.toBe("none");
  await ensureIn(page);
});

test("the landing page's main button glows in LED night only", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: "dark" });
  const shadow = async (theme: ThemeName) => {
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: "http://localhost:3000" }]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    return page
      .locator('a[href="/register"]')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
  };
  for (const theme of ["gate", "dusk"] as const) {
    const plain = await shadow(theme);
    expect(plain, theme).toContain("rgba(0, 0, 0, 0.12) 0px 2px 0px 0px");
    expect(plain, theme).not.toContain("-12px");
  }
  expect(await shadow("led")).toContain("-12px");
  await context.close();
});

for (const theme of ["gate", "led", "dusk"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe: home and account in ${theme} / ${scheme}`, async ({ page, context }) => {
      await useTheme(context, theme);
      await page.emulateMedia({ colorScheme: scheme });
      const errors = watchForErrors(page);
      for (const path of ["/home", "/account"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectTheme(page, theme, scheme);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const problems = axe.violations.map(
          (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
        );
        expect(problems, `${path} accessibility`).toEqual([]);
        await page.screenshot({
          path: `e2e/shots/${process.env.SHOTS ?? "after"}/theme-${theme}-${scheme}${path.replace("/", "-")}.png`,
          fullPage: true,
        });
      }
      expect(errors).toEqual([]);
    });
  }
}
