import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { ADMIN_STATE, STUDENT_STATE } from "../playwright.config";
import { API, CAMPUS, KIOSK_TOKEN, watchForErrors } from "./helpers";

/** The seeded student's access token, read from the session the setup project saved. */
function studentToken(): string {
  const state = JSON.parse(readFileSync(STUDENT_STATE, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error("student session has no access token");
  return cookie.value;
}

/** Open a gate's kiosk in a fresh, signed-out browser and return the code it shows. */
async function openKiosk(browser: Browser, token: string): Promise<{ page: Page; qr: string }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const first = page.waitForResponse((r) => r.url().endsWith("/kiosk/qr") && r.ok());
  await page.goto(`/kiosk#k=${token}`);
  const { qr } = (await (await first).json()) as { qr: string };
  return { page, qr };
}

async function makeSureStudentIsIn(request: APIRequestContext, token: string): Promise<void> {
  await request.post(`${API}/outings/current/return`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe("as a student", () => {
  test("the admin area doesn't exist", async ({ page }) => {
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });
});

test.describe("gate kiosk", () => {
  test("shows a rotating code, and keeps its token off the address bar", async ({ browser }) => {
    const { page, qr } = await openKiosk(browser, KIOSK_TOKEN);
    const errors = watchForErrors(page);
    expect(qr).toMatch(/\/g\/[0-9a-f-]{36}\.\d+\.[0-9A-Z]{10}$/);
    await expect(page.getByRole("heading", { name: "North Gate" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Gate code for North Gate" })).toBeVisible();
    expect(page.url()).not.toContain("#k=");

    await page.reload(); // remembered on the tablet
    await expect(page.getByRole("img", { name: "Gate code for North Gate" })).toBeVisible();
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test("without a kiosk link it explains how to set up", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/kiosk");
    await expect(page.getByRole("heading", { name: "Set up this gate tablet" })).toBeVisible();
    await expect(page.getByLabel("Time now")).toHaveText(/^\d{1,2}:\d{2} [AP]M$/);
    await context.close();
  });

  test("the server never renders the clock, so hydration can't disagree", async ({ request }) => {
    const html = await (await request.get("/kiosk")).text();
    expect(html).toContain('aria-label="Time now"');
    expect(html).not.toMatch(/aria-label="Time now"[^>]*>\s*\d/); // filled in after mount
  });

  test("a phone camera that opens the code gets pointed to the app", async ({ page }) => {
    await page.goto("/g/00000000-0000-4000-8000-000000000000.1.ABCDEFGHIJ");
    await expect(
      page.getByRole("heading", { name: "Scan this in the Lumiback app" }),
    ).toBeVisible();
  });
});

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("a tap-out at the gate shows up verified in the register and scan log", async ({
    page,
    browser,
    request,
  }) => {
    const token = studentToken();
    await makeSureStudentIsIn(request, token);
    const kiosk = await openKiosk(browser, KIOSK_TOKEN);
    const due = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const scan = await request.post(`${API}/gates/scan`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        qr: kiosk.qr,
        lat: CAMPUS.latitude,
        lng: CAMPUS.longitude,
        accuracy_m: 10,
        expected_return_at: due,
        destination: "Rajpur Road",
      },
    });
    expect(scan.status(), await scan.text()).toBe(200);
    await kiosk.page.context().close();

    await page.goto("/admin");
    const row = page.getByRole("row", { name: /Riya Sharma/ });
    await expect(row).toContainText("Verified at North Gate");
    await expect(row).toContainText("to Rajpur Road");

    await page.getByRole("link", { name: "Scans" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Riya Sharma" }).first(),
    ).toContainText("Accepted");
    await makeSureStudentIsIn(request, token);
  });

  test("add a gate, open its kiosk link, switch it off", async ({ page, browser }) => {
    await page.goto("/admin/gates");
    const form = page.getByRole("form", { name: "Add a gate" });
    await form.getByLabel("Name").fill("South Gate");
    await form.getByLabel("Latitude").fill("30.2669");
    await form.getByLabel("Longitude").fill("77.9961");
    await form.getByRole("button", { name: "Add gate" }).click();
    const status = page.getByRole("status").filter({ hasText: "Kiosk link for South Gate" });
    const link = await status.locator("code").textContent();
    const token = new URL(link ?? "").hash.replace("#k=", "");
    expect(token.length).toBeGreaterThan(30);

    const kiosk = await openKiosk(browser, token);
    await expect(kiosk.page.getByRole("heading", { name: "South Gate" })).toBeVisible();

    const south = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "South Gate" }) });
    await south.getByRole("button", { name: "Switch off" }).click();
    await expect(south).toContainText("Switched off");
    await kiosk.page.reload();
    await expect(
      kiosk.page.getByRole("heading", { name: "South Gate is switched off" }),
    ).toBeVisible();
    await kiosk.page.context().close();
  });

  test("change the curfew", async ({ page }) => {
    await page.goto("/admin/settings");
    await page.getByLabel("Hostel curfew (IST)").fill("22:00");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved. New tap-outs use this curfew.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Hostel curfew (IST)")).toHaveValue("22:00");
    await page.getByLabel("Hostel curfew (IST)").fill("21:30");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved. New tap-outs use this curfew.")).toBeVisible();
  });

  test("promote someone to admin and back", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin/people?q=riya");
    const riya = page.getByRole("listitem").filter({ hasText: "Riya Sharma" });
    await riya.getByRole("button", { name: "Make admin" }).click();
    await expect(riya).toContainText("Now an admin.");
    await riya.getByRole("button", { name: "Remove admin" }).click();
    await expect(riya).toContainText("Now a student.");
  });

  test("download the register as CSV", async ({ page }) => {
    await page.goto("/admin");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^outings-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const text = readFileSync(await file.path(), "utf8");
    expect(text.split("\n")[0]).toContain("Name,Email,Roll no.,Destination");
  });
});
