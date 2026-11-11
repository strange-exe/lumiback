import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type Route } from "./fixtures";

import { FAULT_HEADER } from "../src/lib/test-faults";
import { API, signIn, STUDENT, watchForErrors } from "./helpers";

// Signed-in devices on the account page (the lost-phone feature). The backend's own tests cover
// who may sign out what; here: the page, end to end, with real sessions.
//
// "This device" is the seeded student's shared session (the setup project's sign-in, used by
// the default `page`). It survives "Sign out of all other devices", so later specs keep working.
// Each "phone" is a fresh browser with its own User-Agent, which the sign-in passes on to the
// API: the list naming it "Firefox on Android" proves the web sends `user_agent`. Only two
// sign-ins: the API allows 20 per 15 minutes from one IP, and the whole suite shares that.

const SITE = "http://localhost:3000";
const SIGNED_OUT = { cookies: [] as never[], origins: [] as never[] };

const FIREFOX_ANDROID = {
  name: "Firefox on Android",
  agent: "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
};
const SAFARI_IPHONE = {
  name: "Safari on iPhone",
  agent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

/** "Sat 7 Nov, 9:14 PM", optionally with a year: always IST, never "5 minutes ago". */
const STAMP = /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})?, \d{1,2}:\d{2} [AP]M$/;

/** A separate browser (its own cookies) signed in as the seeded student. */
async function phone(browser: Browser, agent: string) {
  const context = await browser.newContext({ storageState: SIGNED_OUT, userAgent: agent });
  const page = await context.newPage();
  await signIn(page, STUDENT);
  return { page, close: () => context.close() };
}

/** The phone's access token, as its browser holds it. */
async function accessTokenOf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "outing_at");
  if (!cookie) throw new Error("no access token cookie");
  return cookie.value;
}

const devices = (page: Page) => page.getByRole("region", { name: "Signed-in devices" });
const row = (page: Page, name: string) =>
  devices(page).getByRole("listitem").filter({ hasText: name });

/** WCAG A/AA problems on the page as it is now. */
async function axeProblems(page: Page): Promise<string[]> {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return axe.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}

/** For review only: DEVICES_SHOTS=<dir> saves the current state at phone and desktop width. */
async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.DEVICES_SHOTS;
  if (!dir) return;
  const size = page.viewportSize();
  for (const [label, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
        scheme === "dark",
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `no horizontal scrolling (${label})`).toBe(false);
      await devices(page).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${dir}/${name}-${label}-${scheme}.png`,
        animations: "disabled",
      });
    }
  }
  if (size) await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: null });
}

test("sign out a lost phone, then every other device", async ({ page, browser, request }) => {
  const errors = watchForErrors(page);
  const lost = await phone(browser, FIREFOX_ANDROID.agent);
  const spare = await phone(browser, SAFARI_IPHONE.agent).catch(async (error: unknown) => {
    await lost.close();
    throw error;
  });
  try {
    await page.goto("/account");
    const list = devices(page);
    await expect(list.getByRole("heading", { name: "Signed-in devices" })).toBeVisible();
    await expect(list).toContainText(
      "Lost your phone? Sign it out here, then change your password.",
    );

    // This device: marked, with IST timestamps, and no Sign out of its own.
    const mine = list.getByRole("listitem").filter({ hasText: "This device" });
    await expect(mine).toHaveCount(1);
    await expect(mine.getByRole("button")).toHaveCount(0);
    const [signedIn, lastActive] = await Promise.all([
      mine.getByText(/^Signed in /).textContent(),
      mine.getByText(/^Last active /).textContent(),
    ]);
    expect(signedIn?.replace("Signed in ", "")).toMatch(STAMP);
    expect(lastActive?.replace("Last active ", "")).toMatch(STAMP);

    // Both phones are listed under the names the API made from their User-Agents.
    await expect(row(page, FIREFOX_ANDROID.name)).toHaveCount(1);
    await expect(row(page, SAFARI_IPHONE.name)).toHaveCount(1);
    await shoot(page, "devices-list");

    // Sign out the lost phone: the dialog names it, and Keep it signed in changes nothing.
    const trigger = row(page, FIREFOX_ANDROID.name).getByRole("button", {
      name: `Sign out: ${FIREFOX_ANDROID.name}`,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: `Sign out of ${FIREFOX_ANDROID.name}?` });
    await expect(dialog).toBeVisible();
    expect(await axeProblems(page)).toEqual([]);
    await shoot(page, "devices-confirm");
    await dialog.getByRole("button", { name: "Keep it signed in" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused(); // focus goes back to the button

    await trigger.click();
    await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(list.getByText(`Signed out of ${FIREFOX_ANDROID.name}.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row(page, FIREFOX_ANDROID.name)).toHaveCount(0);
    await expect(list.getByRole("heading", { name: "Signed-in devices" })).toBeFocused();

    // Its session stops working at once: the API refuses its token, and its pages sign it out.
    const token = await accessTokenOf(lost.page);
    const me = await request.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(401);
    await lost.page.goto("/account");
    await expect(lost.page).toHaveURL(/\/sign-in/);
    // The iPhone wasn't touched.
    await spare.page.goto("/account");
    await expect(devices(spare.page)).toBeVisible();

    // Every other device at once.
    const others = list.getByRole("button", { name: "Sign out of all other devices" });
    await others.click();
    const confirm = page.getByRole("dialog", { name: /^Sign out of \d+ other devices?\?$/ });
    await expect(confirm).toContainText("You stay signed in here.");
    await confirm.getByRole("button", { name: "Sign out of others" }).click();
    await expect(list.getByText(/^Signed out of \d+ devices?\.$/)).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("listitem")).toContainText("This device");
    await expect(list.getByText("No other devices are signed in.")).toBeVisible();
    await expect(others).toHaveCount(0);
    await shoot(page, "devices-only-this");

    await spare.page.goto("/account");
    await expect(spare.page).toHaveURL(/\/sign-in/);
    // And this browser is still signed in.
    await page.reload();
    await expect(devices(page).getByText("This device")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await lost.close();
    await spare.close();
  }
});

test("a list that fails to load says so inside its section, and Try again recovers", async ({
  page,
}) => {
  // The server's own API call can't be intercepted from the browser: ask the dev server to fail
  // it (src/lib/test-faults.ts; E2E_FAULTS=1 is set by playwright.config.ts).
  const fail = (route: Route): Promise<void> =>
    route.continue({ headers: { ...route.request().headers(), [FAULT_HEADER]: "/auth/devices" } });
  const ours = (url: URL): boolean => url.origin === SITE;
  await page.route(ours, fail);
  await page.goto("/account");

  const list = devices(page);
  await expect(list.getByRole("alert")).toHaveText("Your devices couldn't be loaded just now.");
  // The rest of the account page still works.
  await expect(page.getByRole("button", { name: "Download my data" })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  await shoot(page, "devices-error");

  await page.unroute(ours, fail);
  await list.getByRole("button", { name: "Try again" }).click();
  await expect(list.getByText("This device")).toBeVisible();
  await expect(list.getByRole("alert")).toHaveCount(0);
});
