import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

import { API, signIn, STUDENT, watchForErrors } from "./helpers";

// Changing the password while signed in (/account/password). The backend's own tests cover the
// strength rules and the rate limit; here: the page, end to end, with real sessions.
//
// There is no spare seeded student for this, and registering needs an emailed code, so these
// tests use the shared seeded student. "This device" is its shared session (the setup project's
// sign-in, used by the default `page`): a password change keeps it signed in, so later specs keep
// working, and the password is always changed back at the end (through the API, in `finally`, so
// a failed step can't leave every other spec unable to sign in). Only one extra sign-in: the API
// allows 20 per 15 minutes from one IP, and the whole suite shares that.

const SIGNED_OUT = { cookies: [] as never[], origins: [] as never[] };
/** Long enough, not common, and nothing like the student's name or email. */
const NEW_PASSWORD = "copper-kite-meadow-71";

const form = (page: Page) => page.getByRole("region", { name: "Change password" });

/** Server Action posts from this page (Next.js marks them with a Next-Action header). */
function watchActions(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) posts.push(request.url());
  });
  return posts;
}

async function fill(page: Page, current: string, next: string, again: string): Promise<void> {
  const section = form(page);
  await section.getByLabel("Current password", { exact: true }).fill(current);
  await section.getByLabel("New password", { exact: true }).fill(next);
  await section.getByLabel("New password again", { exact: true }).fill(again);
}

/** The shared session's access token, as this browser holds it. */
async function accessTokenOf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "outing_at");
  if (!cookie) throw new Error("no access token cookie");
  return cookie.value;
}

test("the account page and the lost-phone help both link to it", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("link", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("heading", { level: 1, name: "Change password" })).toBeVisible();

  await page.goto("/account");
  const devices = page.getByRole("region", { name: "Signed-in devices" });
  await expect(devices).toContainText(
    "Lost your phone? Sign it out here, then change your password.",
  );
  await expect(devices).not.toContainText("Forgot password");
  await devices.getByRole("link", { name: "change your password" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
});

test("mismatched new passwords are caught before anything is sent", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/account/password");
  const posts = watchActions(page);

  await fill(page, STUDENT.password, NEW_PASSWORD, `${NEW_PASSWORD}x`);
  await form(page).getByRole("button", { name: "Change password" }).click();
  await expect(form(page).getByRole("alert")).toHaveText(
    "The two new passwords don't match. Type them again.",
  );
  expect(posts).toEqual([]); // checked in the browser: no request at all
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a wrong current password shows the backend's message", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/account/password");
  const posts = watchActions(page);

  await fill(page, "not-my-password-1", NEW_PASSWORD, NEW_PASSWORD);
  await form(page).getByRole("button", { name: "Change password" }).click();
  await expect(form(page).getByRole("alert")).toHaveText("Your current password isn't right");
  expect(posts).toHaveLength(1);
  // Nothing changed: still here, still signed in.
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByText(/^Password changed\./)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("changing it signs out the other browser and keeps this one signed in", async ({
  page,
  browser,
  request,
}) => {
  const errors = watchForErrors(page);
  const other = await browser.newContext({ storageState: SIGNED_OUT });
  let sent = false;
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, STUDENT);
    await otherPage.goto("/account");
    await expect(otherPage.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

    await page.goto("/account/password");
    await fill(page, STUDENT.password, NEW_PASSWORD, NEW_PASSWORD);
    sent = true; // from here the password may have changed, whatever the page shows
    await form(page).getByRole("button", { name: "Change password" }).click();
    const done = page.getByRole("status").filter({ hasText: /^Password changed\./ });
    // At least the other browser; earlier specs' sign-ins may still be live too.
    await expect(done).toHaveText(/^Password changed\. Signed out of \d+ other devices?\.$/);
    await expect(done).toBeFocused();
    await expect(form(page).getByLabel("Current password", { exact: true })).toHaveCount(0);

    // The other browser's session is over: its next page sends it to sign in.
    await otherPage.goto("/account");
    await expect(otherPage).toHaveURL(/\/sign-in/);

    // This one stays signed in, and the account page still lists it.
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    const devices = page.getByRole("region", { name: "Signed-in devices" });
    await expect(devices.getByText("This device")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    if (sent) {
      // Back to the seeded password for every later spec, keeping this session signed in.
      // 403: the change never happened (the current password is still the seeded one).
      const restored = await request.post(`${API}/auth/change-password`, {
        headers: { Authorization: `Bearer ${await accessTokenOf(page)}` },
        data: { current_password: NEW_PASSWORD, password: STUDENT.password },
      });
      expect([200, 403], "the seeded password is restored").toContain(restored.status());
    }
  }
});
