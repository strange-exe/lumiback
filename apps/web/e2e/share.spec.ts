import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  allowLocation,
  ensureIn,
  newJoinCode,
  startSharing,
  stopSharing,
  stubMapTiles,
  watchForErrors,
} from "./helpers";

const SIGNED_OUT = { cookies: [], origins: [] };
const SHARER = "Riya Sharma"; // the seeded e2e student
const BACKEND = "http://127.0.0.1:8100"; // the e2e API started by playwright.config.ts

/** A friend with no account, in their own browser. */
async function guestPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: SIGNED_OUT });
  await stubMapTiles(context);
  return context.newPage();
}

async function joinAsGuest(guest: Page, code: string, name: string): Promise<void> {
  await guest.goto("/join");
  await guest.getByLabel("Join code").fill(code);
  await guest.getByLabel("Your name").fill(name);
  await guest.getByRole("button", { name: "Ask to follow along" }).click();
  await expect(guest).toHaveURL(/\/watch\/[0-9a-f-]{36}$/);
}

/** The backend's own word on the share the guest is watching, for a failure message. */
async function shareState(context: BrowserContext, guest: Page): Promise<string> {
  const id = new URL(guest.url()).pathname.split("/").pop();
  const token = (await context.cookies()).find((c) => c.name === "outing_at")?.value;
  const response = await context.request.get(`${BACKEND}/sessions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok()) return `The backend answered ${response.status()} for the share.`;
  const share = (await response.json()) as { status: string; ended_reason: string | null };
  return share.status === "active"
    ? "The share is still active: the tab-close beacon never ended it."
    : `The share ended (${share.ended_reason}), but the guest's page never showed it.`;
}

test.describe("live sharing", () => {
  test.beforeEach(async ({ context }) => {
    await allowLocation(context);
    await stubMapTiles(context);
  });

  test("a guest sees a share only after approval, follows it live, and loses it on stop", async ({
    page,
    browser,
  }) => {
    const errors = watchForErrors(page);
    await startSharing(page);
    const code = await newJoinCode(page);

    const guest = await guestPage(browser);
    const guestErrors = watchForErrors(guest);
    await joinAsGuest(guest, code, "Mom");
    await expect(guest.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
    await expect(guest.getByRole("region", { name: /^Map/ })).toHaveCount(0); // nothing yet

    // The request shows up on the student's screen by itself.
    await expect(page.getByRole("heading", { name: "Waiting for you" })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Approve Mom (guest)" }).click();
    await expect(page.getByText("can see your location")).toBeVisible();

    await expect(guest.getByRole("heading", { name: `${SHARER}'s way back` })).toBeVisible();
    await expect(guest.getByText(/^Live · updated/)).toBeVisible();
    await expect(guest.getByRole("region", { name: /accurate to about 12 metres/ })).toBeVisible();

    // The student moves; the guest's map follows without a reload.
    await page.context().setGeolocation({ latitude: 30.2701, longitude: 77.9969, accuracy: 30 });
    await expect(guest.getByRole("region", { name: /accurate to about 30 metres/ })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(page.getByText("You stopped sharing.")).toBeVisible();
    await expect(guest.getByRole("heading", { name: `${SHARER} stopped sharing.` })).toBeVisible();
    await expect(guest.getByRole("region", { name: /^Map/ })).toHaveCount(0);

    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
    await guest.context().close();
  });

  test("closing the share tab ends the share for everyone", async ({ page, browser, context }) => {
    await startSharing(page);
    const code = await newJoinCode(page);
    const guest = await guestPage(browser);
    await joinAsGuest(guest, code, "Arjun");
    await page.getByRole("button", { name: "Approve Arjun (guest)" }).click({ timeout: 10_000 });
    await expect(guest.getByText(/^Live · updated/)).toBeVisible();

    // The dev server compiles a route on its first request, and only this test calls the stop
    // route: compile it now (a refused request: no share ends), so the wait below measures the
    // beacon, not a cold compile on a slow CI runner.
    const warm = await page.request.post(`/api/share/${crypto.randomUUID()}/stop`);
    expect(warm.status()).toBeLessThan(500);

    page.on("dialog", (dialog) => void dialog.accept()); // the "Leave site?" confirmation
    await page.close({ runBeforeUnload: true });

    const stopped = guest.getByRole("heading", { name: `${SHARER} stopped sharing.` });
    await expect(stopped)
      .toBeVisible({ timeout: 10_000 })
      .catch(async (error: unknown) => {
        // Traces don't record beacons, so say which half failed: the share never ended (the
        // beacon or the stop route), or it ended and the guest's stream didn't show it.
        throw new Error(`${await shareState(context, guest)}\n${String(error)}`);
      });
    await guest.context().close();
  });

  test("removing a viewer cuts them off at once", async ({ page, browser }) => {
    await startSharing(page);
    const code = await newJoinCode(page);
    const guest = await guestPage(browser);
    await joinAsGuest(guest, code, "Kabir");
    await page.getByRole("button", { name: "Approve Kabir (guest)" }).click({ timeout: 10_000 });
    await expect(guest.getByText(/^Live · updated/)).toBeVisible();

    await page.getByRole("button", { name: "Remove Kabir (guest)" }).click();
    await expect(
      guest.getByRole("heading", { name: `${SHARER} removed you from their share.` }),
    ).toBeVisible();
    await stopSharing(page);
    await guest.context().close();
  });

  test("a faked location shows in red beside the last real one", async ({ page, browser }) => {
    await startSharing(page);
    const code = await newJoinCode(page);
    const guest = await guestPage(browser);
    const guestErrors = watchForErrors(guest);
    await joinAsGuest(guest, code, "Didi");
    await page.getByRole("button", { name: "Approve Didi (guest)" }).click({ timeout: 10_000 });
    await expect(guest.getByText(/^Live · updated/)).toBeVisible();

    // What the Android app sends while a mock-location app runs (browsers can't tell). Dated a
    // minute ahead (within the API's clock-skew allowance) so it stays newer than the real fixes
    // this tab keeps sending during the test.
    const sessionId = new URL(guest.url()).pathname.split("/").pop();
    const token = (await page.context().cookies()).find((c) => c.name === "outing_at")?.value;
    const put = await page.request.put(`${BACKEND}/sessions/${sessionId}/location`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        lat: 30.3256,
        lng: 78.0437,
        accuracy_m: 5,
        recorded_at: new Date(Date.now() + 60_000).toISOString(),
        mocked: true,
      },
    });
    expect(put.status()).toBe(204);

    const alert = guest.getByRole("alert").filter({ hasText: "Location is being faked" });
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(
      /the other dot is the last real one, from .+, [\d.]+ km away/,
    );
    await expect(guest.getByText("Location faked by a mock-location app")).toBeVisible();
    await expect(
      guest.getByRole("region", { name: /A faked location is shown in red/ }),
    ).toBeVisible();
    await expect(guest.locator(".live-dot.is-fake")).toHaveCount(1);
    // The "Open in Google Maps" link keeps pointing at the real position, never the fake one.
    await expect(guest.getByRole("link", { name: "Open in Google Maps" })).not.toHaveAttribute(
      "href",
      /30\.3256/,
    );

    await stopSharing(page);
    expect(guestErrors).toEqual([]);
    await guest.context().close();
  });

  test("while sharing, every page says so", async ({ page }) => {
    await startSharing(page);
    await page.getByRole("link", { name: "Today" }).click();
    const bar = page.getByRole("link", { name: /Sharing your location · 0 viewers/ });
    await expect(bar).toBeVisible();
    await bar.click();
    await expect(page).toHaveURL(/\/share$/);
    await stopSharing(page);
  });
});

test.describe("guards", () => {
  test.use({ storageState: SIGNED_OUT });

  test("a made-up code is refused calmly", async ({ page }) => {
    await page.goto("/join");
    await page.getByLabel("Join code").fill("00000-00000");
    await page.getByLabel("Your name").fill("Stranger");
    await page.getByRole("button", { name: "Ask to follow along" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("That code didn't work.");
  });

  test("a share you never joined shows nothing", async ({ page }) => {
    await page.goto("/watch/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "This share isn't available" })).toBeVisible();
  });

  test("a safe-return link with a made-up key sets no guest cookie", async ({ page }) => {
    const id = "00000000-0000-4000-8000-000000000000";
    await page.goto(`/watch/${id}#key=${"x".repeat(43)}`);
    await expect(page.getByRole("heading", { name: "This share isn't available" })).toBeVisible();
    expect(page.url()).not.toContain("key=");
    const cookies = await page.context().cookies();
    expect(cookies.filter((c) => c.name.startsWith("outing_guest_"))).toEqual([]);
  });

  test("an invite link fills in the code, then drops it from the address bar", async ({ page }) => {
    await page.goto("/join#code=7KQ2M-XW4PD");
    await expect(page.getByLabel("Join code")).toHaveValue("7KQ2M-XW4PD");
    expect(page.url()).not.toContain("7KQ2M");
  });

  test("other sites cannot post locations or stop shares through the web app", async ({
    request,
  }) => {
    const id = "00000000-0000-4000-8000-000000000000";
    const fix = { lat: 0, lng: 0, accuracy_m: 1, recorded_at: new Date().toISOString() };
    const evil = { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" };
    const put = await request.put(`/api/share/${id}/location`, { data: fix, headers: evil });
    expect(put.status()).toBe(403);
    const stop = await request.post(`/api/share/${id}/stop`, { headers: evil });
    expect(stop.status()).toBe(403);
  });
});

/** Save the student's contacts, with the emergency contact's email ("" clears it). */
async function setEmergencyContact(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/account");
  await page.getByLabel("Your phone number").fill("9000000099");
  await page.getByLabel("Emergency contact", { exact: true }).fill(name);
  await page.getByLabel("Relation").fill("Mother");
  await page.getByLabel("Their phone").fill("9000000199");
  await page.getByLabel("Their email (optional)").fill(email);
  await page.getByRole("button", { name: "Save contacts" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
}

test.describe("safe return", () => {
  test.beforeEach(async ({ context }) => {
    await allowLocation(context);
    await stubMapTiles(context);
  });

  test("the student can tell the real emergency contact from a guest who copies the name", async ({
    page,
    browser,
  }) => {
    const errors = watchForErrors(page);
    await stopSharing(page);
    await ensureIn(page);
    await setEmergencyContact(page, "Sunita", "sunita.e2e@example.com");
    try {
      await page.goto("/home");
      await page.getByLabel("Where to? (optional)").fill("Clock Tower");
      await page.getByRole("checkbox", { name: /follow until I'm back/ }).check();
      await page.getByRole("button", { name: "Check out" }).click();
      await expect(page.getByRole("heading", { name: "Clock Tower" })).toBeVisible();

      await page.goto("/share");
      const contact = page.getByRole("listitem").filter({ hasText: "Your emergency contact" });
      await expect(contact).toContainText("Sunita (emergency contact)");
      await expect(contact).not.toContainText("(guest)");

      // A code holder picks a look-alike of the contact's label (a Cyrillic "e").
      const lookAlike = "Sunita (" + String.fromCodePoint(0x0435) + "mergency contact)";
      const code = await newJoinCode(page);
      const guest = await guestPage(browser);
      await joinAsGuest(guest, code, lookAlike);
      const request = page.getByRole("listitem").filter({ hasText: "wants to see" });
      await expect(request).toContainText(`${lookAlike} (guest)`, { timeout: 10_000 });
      await expect(request).not.toContainText("Your emergency contact");
      await page.screenshot({ path: "e2e/shots/after/share-contact-marker.png", fullPage: true });
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      await page.getByRole("button", { name: `Decline ${lookAlike} (guest)` }).click();
      await guest.context().close();
      expect(errors).toEqual([]);
    } finally {
      await stopSharing(page);
      await ensureIn(page);
      await setEmergencyContact(page, "Sunita", "");
    }
  });
});
