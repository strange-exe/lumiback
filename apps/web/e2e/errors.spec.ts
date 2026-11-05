import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { ADMIN_STATE } from "../playwright.config";
import { FAULT_HEADER } from "../src/lib/test-faults";

const SITE = "http://localhost:3000";

/**
 * Error and not-found pages. The server's own API calls can't be intercepted from the browser, so
 * a test asks the dev server to fail them with a header (src/lib/test-faults.ts; the Next server
 * must run with E2E_FAULTS=1, which playwright.config.ts sets).
 */
async function failApiCalls(page: Page, paths: string[]): Promise<() => Promise<void>> {
  const handler = (route: Route): Promise<void> =>
    route.continue({
      headers: { ...route.request().headers(), [FAULT_HEADER]: paths.join(",") },
    });
  // Only our own pages (playwright.config.ts baseURL): never the API, the tile CDN or others.
  const match = (url: URL): boolean => url.origin === SITE;
  await page.route(match, handler);
  return () => page.unroute(match, handler);
}

const errorHeading = (page: Page) => page.getByRole("heading", { name: "This page didn't load" });

test.describe("in the office", () => {
  test.use({ storageState: ADMIN_STATE });

  test("a failed API call shows the error inside the office, and Try again recovers", async ({
    page,
  }) => {
    const stop = await failApiCalls(page, ["/admin/overview"]);
    await page.goto("/admin");

    await expect(
      errorHeading(page),
      "no error page: is the Next dev server running with E2E_FAULTS=1?",
    ).toBeVisible();
    await expect(page.getByText(/server didn't answer/)).toBeVisible();
    // The office header and nav stay, so staff can go elsewhere.
    await expect(page.getByRole("navigation", { name: "Hostel office" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the Register" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Email us" })).toHaveAttribute("href", /^mailto:/);
    // The heading takes focus so screen readers announce the change.
    await expect(errorHeading(page)).toBeFocused();

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    await stop();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Register", level: 1 })).toBeVisible();
    await expect(errorHeading(page)).toHaveCount(0);
  });

  test("offline says so, and goes back when the connection returns", async ({ page, context }) => {
    const stop = await failApiCalls(page, ["/admin/escalations"]);
    await page.goto("/admin/escalations");
    await expect(errorHeading(page)).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await context.setOffline(false);
    await expect(errorHeading(page)).toBeVisible();

    await stop();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Escalations", level: 1 })).toBeVisible();
  });
});

test.describe("in the student app", () => {
  test("a failed page keeps the app's header and footer, and Try again recovers", async ({
    page,
  }) => {
    const stop = await failApiCalls(page, ["/outings/summary"]);
    await page.goto("/history");

    await expect(errorHeading(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible();

    await stop();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page
        .getByRole("heading", { name: "Your outings" })
        .or(page.getByRole("heading", { name: "No outings yet" })),
    ).toBeVisible();
    await expect(errorHeading(page)).toHaveCount(0);
  });
});

test.describe("not found", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`an unknown link gets our 404 page (${scheme})`, async ({ page }) => {
      const response = await page.goto("/no-such-page");
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      expect(
        await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches),
        "colour scheme not applied",
      ).toBe(scheme === "dark");

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Today" })).toHaveAttribute(
        "href",
        "/home",
      );
      await expect(page).toHaveTitle(/Page not found/);

      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }
});
