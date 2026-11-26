import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { ADMIN_STATE } from "../playwright.config";
import { signIn, STUDENT } from "./helpers";

/**
 * How often the website asks the API again. The site makes every API call from one address, so
 * the hosting's inbound limit counts the office's auto-refresh for everyone at once: the
 * register, requests and escalations pages re-render once a minute while visible (owner,
 * 2026-11-27; it was every 30 s), on a faked clock here so the test doesn't wait.
 */

/** Count this page's own refreshes: RSC requests for `path` that aren't link prefetches. */
function countRefreshes(page: Page, path: string): () => number {
  let count = 0;
  page.on("request", (request) => {
    const headers = request.headers();
    if (
      new URL(request.url()).pathname === path &&
      headers.rsc === "1" &&
      headers["next-router-prefetch"] === undefined
    ) {
      count += 1;
    }
  });
  return () => count;
}

test.describe("the office's auto-refresh", () => {
  test.use({ storageState: ADMIN_STATE });

  for (const path of ["/admin", "/admin/requests", "/admin/escalations"]) {
    test(`${path} re-renders once a minute, not every 30 s`, async ({ page }) => {
      await page.clock.install();
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const refreshes = countRefreshes(page, path);

      await page.clock.runFor(31_000);
      // Give a refresh that 30 s would have started time to reach the network.
      await page.waitForTimeout(1_500);
      expect(refreshes(), "no refresh at 31 s").toBe(0);

      await page.clock.runFor(30_000); // 61 s in all
      await expect.poll(refreshes, { message: "one refresh by 61 s" }).toBe(1);
    });
  }

  test("the register says how often it updates", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(/^Updates every minute\W/)).toBeVisible();
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // The signed-in person is looked up once per request (lib/session.ts). Signing in and out
  // change the cookies in a Server Action whose redirect renders in the same response: that
  // render must see the new session, never a remembered one.
  test("sign in and sign out take effect in the same response", async ({ page, context }) => {
    await signIn(page, STUDENT);
    await expect(page.getByText("Signed in as Riya Sharma")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await context.cookies()).map((c) => c.name)).not.toContain("outing_at");
    await page.goto("/home");
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
