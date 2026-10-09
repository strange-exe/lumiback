import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { ADMIN_STATE, STUDENT_STATE } from "../playwright.config";
import { API, CAMPUS, KIOSK_TOKEN, watchForErrors } from "./helpers";

/** An access token from a session the setup project saved. */
function tokenFrom(file: string): string {
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error(`${file} has no access token`);
  return cookie.value;
}

const studentToken = (): string => tokenFrom(STUDENT_STATE);
const adminToken = (): string => tokenFrom(ADMIN_STATE);

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

/** Turn the e2e default rules into weekend/holiday rules (form + approval, up to 3 h) and back. */
async function formDay(request: APIRequestContext, on: boolean): Promise<void> {
  const admin = { Authorization: `Bearer ${adminToken()}` };
  const sets = (await (await request.get(`${API}/admin/rule-sets`, { headers: admin })).json()) as {
    id: string;
    name: string;
    days: Record<string, unknown>[];
  }[];
  const rules = sets[0]!;
  const days = rules.days.map((d) => ({ ...d, needs_form: on, max_minutes: on ? 180 : null }));
  const r = await request.put(`${API}/admin/rule-sets/${rules.id}`, {
    headers: admin,
    data: { name: rules.name, days },
  });
  expect(r.ok()).toBe(true);
}

test.describe("as a student on a form day", () => {
  test("ask for today's outing, see it waiting, cancel it", async ({ page, request }) => {
    await makeSureStudentIsIn(request, studentToken());
    await formDay(request, true);
    try {
      await page.goto("/home");
      await expect(
        page.getByText("Needs the hostel office's OK first.", { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Check out" })).toHaveCount(0); // approval first
      const form = page.getByRole("form", { name: "Ask for today's outing" });
      await form.getByLabel("Where and why").fill("Shopping at Pacific Mall");
      await form.getByText("1 h", { exact: true }).click();
      await form.getByLabel("Your phone number").fill("98765 43210");
      await form.getByLabel("Emergency contact").fill("Sunita Sharma");
      await form.getByLabel("Relation").fill("Mother");
      await form.getByLabel("Their phone").fill("12345");
      await form.getByRole("button", { name: "Send for approval" }).click();
      await expect(form.getByRole("alert")).toContainText("10-digit Indian mobile number");
      await form.getByLabel("Their phone").fill("91234 56789");
      await form.getByRole("button", { name: "Send for approval" }).click();
      const waiting = page.getByRole("status").filter({ hasText: "Waiting for approval." });
      await expect(waiting).toContainText("Shopping at Pacific Mall");
      await waiting.getByRole("button", { name: "Cancel request" }).click();
      await expect(page.getByRole("form", { name: "Ask for today's outing" })).toBeVisible();
    } finally {
      await formDay(request, false);
    }
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

  test("change how long gate scans are kept", async ({ page }) => {
    await page.goto("/admin/settings");
    const days = page.getByLabel("Keep gate scans for (days)");
    await days.fill("90");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(days).toHaveValue("90");
    await days.fill("180");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("outing rules: add a hostel with its warden, mark a holiday", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin/rules");
    await expect(page.getByRole("heading", { name: "Outing rules" })).toBeVisible();
    await expect(page.getByText("Default for students without a hostel")).toBeVisible();

    const hostels = page.getByRole("region", { name: "Hostels" });
    const blank = hostels.locator("form").last();
    await blank.getByLabel("Hostel").fill("Hostel 7");
    await blank.getByLabel("Warden", { exact: true }).fill("Mr. Negi");
    await blank.getByLabel("Warden's phone").fill("98765 00000");
    await blank.getByRole("button", { name: "Add hostel" }).click();
    await expect(hostels.getByText("Added Hostel 7.")).toBeVisible();
    const saved = hostels.locator("form").filter({ has: page.locator('input[value="Hostel 7"]') });
    await expect(saved.getByLabel("Warden's phone")).toHaveValue("+919876500000"); // dialable
    await hostels.getByRole("button", { name: "Remove" }).first().click();
    await expect(page.locator('input[value="Hostel 7"]')).toHaveCount(0);

    const holidays = page.getByRole("region", { name: "Holidays" });
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    await holidays.getByLabel("Date").fill(tomorrow);
    await holidays.getByLabel("Holiday").fill("Founders' Day");
    await holidays.getByRole("button", { name: "Add holiday" }).click();
    await expect(holidays.getByRole("listitem").filter({ hasText: "Founders' Day" })).toBeVisible();
    await holidays
      .getByRole("listitem")
      .filter({ hasText: "Founders' Day" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(holidays.getByText("No upcoming holidays.")).toBeVisible();
  });

  test("a weekend request: the student asks, an admin approves", async ({ page, request }) => {
    const admin = { Authorization: `Bearer ${adminToken()}` };
    const student = { Authorization: `Bearer ${studentToken()}` };
    await makeSureStudentIsIn(request, studentToken());
    const sets = (await (
      await request.get(`${API}/admin/rule-sets`, { headers: admin })
    ).json()) as {
      id: string;
      name: string;
      days: Record<string, unknown>[];
    }[];
    const rules = sets[0]!;
    const withForm = (needs: boolean) => ({
      name: rules.name,
      days: rules.days.map((d) => ({ ...d, needs_form: needs, max_minutes: needs ? 180 : null })),
    });
    const put = (needs: boolean) =>
      request.put(`${API}/admin/rule-sets/${rules.id}`, { headers: admin, data: withForm(needs) });
    expect((await put(true)).ok()).toBe(true);
    try {
      const sent = await request.post(`${API}/outings/request`, {
        headers: student,
        data: {
          purpose: "Shopping at Pacific Mall",
          phone: "9876543210",
          emergency_name: "Sunita Sharma",
          emergency_relation: "Mother",
          emergency_phone: "9123456789",
        },
      });
      expect(sent.status(), await sent.text()).toBe(201);

      await page.goto("/admin");
      await page.getByRole("link", { name: "1 outing request to decide" }).click();
      // The newest request (earlier tests may have left a cancelled one from the same student).
      const waiting = page
        .getByRole("article")
        .filter({ hasText: "Riya Sharma" })
        .filter({ hasText: "Waiting for you" });
      // Pin it: once decided it no longer says "Waiting for you".
      const id = await waiting.getAttribute("aria-labelledby");
      const card = page.locator(`article[aria-labelledby="${id}"]`);
      await expect(card).toContainText("Shopping at Pacific Mall");
      await expect(card.getByRole("link", { name: "+91 91234 56789" })).toHaveAttribute(
        "href",
        "tel:+919123456789",
      );
      await page.screenshot({ path: "e2e/shots/after/admin-request-pending.png", fullPage: true });
      await card.getByRole("button", { name: "Decline" }).click();
      await expect(card.getByRole("alert")).toHaveText("Say why, so the student knows what to do.");
      await card.getByRole("button", { name: "Approve" }).click();
      await expect(card).toContainText("Approved by Asha Rawat");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "e2e/shots/after/admin-request-approved-mobile.png",
        fullPage: true,
      });
    } finally {
      await put(false);
    }
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
