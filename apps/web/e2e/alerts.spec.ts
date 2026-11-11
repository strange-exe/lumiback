import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Locator } from "./fixtures";

import { ADMIN_STATE, STUDENT_STATE } from "../playwright.config";
import { allowLocation, API, checkOut, ensureIn, watchForErrors } from "./helpers";

// Wave 2 alerts on the website: the follow-up timings in Settings, a student who is out
// reaching the hostel office and sending Help, and the office handling the help request.
// Who may do what is covered by the backend's tests/test_alerts.py; here: the pages.
// Lean on purpose: sessions expire at 15 minutes and the full suite is already long.

/** An access token from a session the setup project saved. */
function tokenFrom(file: string): string {
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error(`${file} has no access token`);
  return cookie.value;
}

const asStudent = () => ({ Authorization: `Bearer ${tokenFrom(STUDENT_STATE)}` });
const asAdmin = () => ({ Authorization: `Bearer ${tokenFrom(ADMIN_STATE)}` });

const REALERT = "Alert the office again about a late student every (minutes)";

/** Marks every open help request handled, so other specs see an empty list. */
async function handleAllHelp(request: APIRequestContext): Promise<void> {
  const open = (await (
    await request.get(`${API}/admin/help?state=open`, { headers: asAdmin() })
  ).json()) as { id: string }[];
  for (const h of open) {
    await request.post(`${API}/admin/help/${h.id}/handle`, { headers: asAdmin(), data: {} });
  }
}

/** Clicks a button that opens a dialog by script until it shows (a click before hydration does nothing). */
async function openDialog(button: Locator, dialog: Locator): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("follow-up timings save and show again after a reload", async ({ page, request }) => {
    const errors = watchForErrors(page);
    const before = (await (
      await request.get(`${API}/admin/settings`, { headers: asAdmin() })
    ).json()) as { escalation_realert_minutes: number };
    try {
      await page.goto("/admin/settings");
      // Closed by default so Save stays in the first screen (design.spec checks that).
      const timings = page.locator("summary", { hasText: "Follow-up timings" });
      const realert = page.getByLabel(REALERT);
      await expect(realert).toBeHidden();
      await timings.click();
      await expect(realert).toHaveValue(String(before.escalation_realert_minutes));
      // A value the browser refuses, in the closed section: Save opens it to show the field.
      await realert.fill("300");
      await timings.click();
      await expect(realert).toBeHidden();
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(realert).toBeVisible();
      const tooBig = await realert.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow);
      expect(tooBig).toBe(true);
      await realert.fill("20");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
      await page.reload();
      await timings.click();
      await expect(realert).toHaveValue("20");
    } finally {
      // Put back exactly what was there (GET and PUT share one shape).
      await request.put(`${API}/admin/settings`, { headers: asAdmin(), data: before });
    }
    expect(errors).toEqual([]);
  });
});

test.describe("as a student who is out", () => {
  test("can reach the office, and Help asks first, then sends", async ({ page, request }) => {
    const errors = watchForErrors(page);
    await allowLocation(page.context()); // one fix, at once, instead of a prompt
    try {
      await checkOut(page, "Alerts check");
      const office = page.getByRole("region", { name: "Hostel office" });
      // The seeded hostel may or may not have an office number.
      await expect(
        office
          .getByRole("link", { name: /Call the hostel office/ })
          .or(office.getByRole("button", { name: "Ask the office to call me" })),
      ).toBeVisible();

      const dialog = page.getByRole("dialog", { name: "Send a help alert?" });
      await openDialog(office.getByRole("button", { name: "Help", exact: true }), dialog);
      await expect(dialog).toContainText("One location is sent, not tracking.");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();

      await openDialog(office.getByRole("button", { name: "Help", exact: true }), dialog);
      await dialog.getByRole("button", { name: "Send help alert" }).click();
      await expect(dialog).toBeHidden();
      await expect(office.getByRole("status")).toContainText(
        "Help is on its way to the hostel office.",
      );
    } finally {
      await ensureIn(page);
      await handleAllHelp(request);
    }
    expect(errors).toEqual([]);
  });
});

test.describe("the office", () => {
  test.use({ storageState: ADMIN_STATE });

  test("sees who asked for help, where, and marks it handled", async ({ page, request }) => {
    const errors = watchForErrors(page);
    await handleAllHelp(request);
    await request.post(`${API}/outings/current/return`, { headers: asStudent() });
    const out = await request.post(`${API}/outings`, {
      headers: asStudent(),
      data: { destination: "Rajpur Road" },
    });
    expect(out.ok()).toBe(true);
    try {
      const sent = await request.post(`${API}/outings/current/help`, {
        headers: asStudent(),
        data: { location: { lat: 30.2687, lng: 77.9947, accuracy_m: 25, mocked: true } },
      });
      expect(sent.status()).toBe(201);

      await page.goto("/admin/escalations");
      const section = page.getByRole("region", { name: "Asked for help" });
      const card = section.getByRole("article");
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("Still out");
      await expect(card).toContainText("within 25 m");
      await expect(card).toContainText("mock location");
      await expect(card.getByRole("link", { name: "Open map" })).toHaveAttribute(
        "href",
        "https://www.openstreetmap.org/?mlat=30.2687&mlon=77.9947#map=17/30.2687/77.9947",
      );

      await card.getByLabel("What happened (optional)").fill("Called her: she's on the way");
      await card.getByRole("button", { name: "Mark handled" }).click();
      await expect(section.getByText("Nobody has asked for help.")).toBeVisible();
      await expect(card).toHaveCount(0);
    } finally {
      await request.post(`${API}/outings/current/return`, { headers: asStudent() });
      await handleAllHelp(request);
    }
    expect(errors).toEqual([]);
  });
});
