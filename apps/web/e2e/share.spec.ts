import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  allowLocation,
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

  test("closing the share tab ends the share for everyone", async ({ page, browser }) => {
    await startSharing(page);
    const code = await newJoinCode(page);
    const guest = await guestPage(browser);
    await joinAsGuest(guest, code, "Arjun");
    await page.getByRole("button", { name: "Approve Arjun (guest)" }).click({ timeout: 10_000 });
    await expect(guest.getByText(/^Live · updated/)).toBeVisible();

    page.on("dialog", (dialog) => void dialog.accept()); // the "Leave site?" confirmation
    await page.close({ runBeforeUnload: true });

    await expect(guest.getByRole("heading", { name: `${SHARER} stopped sharing.` })).toBeVisible({
      timeout: 10_000,
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
