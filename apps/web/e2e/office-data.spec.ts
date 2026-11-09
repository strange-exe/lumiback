import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { ADMIN_STATE, STUDENT_STATE, WARDEN_STATE } from "../playwright.config";
import { designMatrix, KIOSK_TOKEN, watchForErrors } from "./helpers";

// Wave 1 office data: kiosk quiet hours and health, the register's and scans' search and dates,
// the audit log, and a student's record. Who may call each API is covered by the backend's
// tests (test_kiosk_health.py, test_office_data.py); here: the pages, end to end.

const UUID = /\/admin\/people\/([0-9a-f-]{36})$/;

/** "HH:MM" in IST, `minutes` from now. */
function istClock(minutes: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Date.now() + minutes * 60_000));
}

/** Today's date in IST (YYYY-MM-DD). */
const istToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const current = (page: Page, nav: string) =>
  page.getByRole("navigation", { name: nav }).locator('[aria-current="page"]');

/** A click before the page hydrates is lost (People and Settings run scripts): retry until it holds. */
async function openDialog(button: Locator, dialog: Locator): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

async function asWho(browser: Browser, storageState: string) {
  const context = await browser.newContext({ storageState });
  return { page: await context.newPage(), close: () => context.close() };
}

/** Kiosk quiet hours on (a window around now) or off, from Settings. */
async function setQuietHours(page: Page, on: boolean): Promise<void> {
  await page.goto("/admin/settings");
  const box = page.getByRole("checkbox", { name: "Switch gate kiosks off at night" });
  await expect(async () => {
    await box.setChecked(on);
    await expect(box).toBeChecked({ checked: on, timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  if (on) {
    await page.getByLabel("Off from").fill(istClock(-60));
    await page.getByLabel("Back on at").fill(istClock(60));
  }
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  // After the save the box still says what was saved, and the times show only when on.
  await expect(box).toBeChecked({ checked: on });
  await expect(page.getByLabel("Off from")).toBeVisible({ visible: on });
}

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("kiosk quiet hours pause the tablet, and Gates shows each tablet's health", async ({
    page,
    browser,
  }) => {
    const errors = watchForErrors(page);
    const kiosk = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      await setQuietHours(page, true);
      await designMatrix(page, "settings-quiet-hours");

      // The tablet says when it opens instead of showing a code.
      const tablet = await kiosk.newPage();
      await tablet.goto(`/kiosk#k=${KIOSK_TOKEN}`);
      await expect(
        tablet.getByRole("heading", { name: /^Opens at \d{1,2}:\d{2} [AP]M$/ }),
      ).toBeVisible();
      await expect(tablet.getByRole("img", { name: "Gate code for North Gate" })).toHaveCount(0);

      await page.goto("/admin/gates");
      const north = page.getByRole("listitem").filter({ hasText: "North Gate" });
      await expect(north.getByText("Quiet hours", { exact: true })).toBeVisible();
      await expect(north).toContainText("Kiosks are paused until");

      await setQuietHours(page, false);
      await tablet.reload();
      await expect(tablet.getByRole("img", { name: "Gate code for North Gate" })).toBeVisible();
      await page.goto("/admin/gates");
      // The label carries the meaning; the colour only repeats it.
      await expect(north.getByText("Tablet online", { exact: true })).toBeVisible();
      await expect(north).toContainText("Last asked for a code at");
      await designMatrix(page, "gates-kiosk-health");
    } finally {
      await kiosk.close();
      await setQuietHours(page, false);
    }
    expect(errors).toEqual([]);
  });

  test("the register's search rides along with its filters but isn't remembered", async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await page.goto("/admin");
    const search = page.getByRole("searchbox", { name: "Name or roll number" });
    await search.fill("riya");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?q=riya$/);
    await expect(search).toHaveValue("riya");
    await page.getByRole("link", { name: "Late", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?state=overdue&q=riya$/);
    await expect(page.getByText('Nobody matching "riya" is late right now.')).toBeVisible();
    await designMatrix(page, "register-search");

    // A bare visit: the Late filter is remembered, the search isn't.
    await page.goto("/admin");
    await expect(current(page, "Filter")).toHaveText("Late");
    await expect(search).toHaveValue("");
    await page.getByRole("link", { name: "Everyone out" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(errors).toEqual([]);
  });

  test("scans take a name search and a date range, checked before asking", async ({ page }) => {
    const errors = watchForErrors(page);
    const today = istToday();
    await page.goto("/admin/scans");
    await page.getByRole("searchbox", { name: "Student name or roll number" }).fill("riya");
    await page.getByLabel("From", { exact: true }).fill(today);
    await page.getByLabel("To", { exact: true }).fill(today);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/scans\\?q=riya&from=${today}&to=${today}$`));
    await expect(page.getByLabel("From", { exact: true })).toHaveValue(today);
    await designMatrix(page, "scans-search");

    // Not remembered: a bare visit opens every scan.
    await page.goto("/admin/scans");
    await expect(page.getByRole("searchbox", { name: "Student name or roll number" })).toHaveValue(
      "",
    );

    // An end before the start is explained, never sent to the API as a range.
    await page.goto("/admin/scans?from=2026-11-08&to=2026-11-01");
    // Scoped to main: Next's route announcer is an (empty) alert too.
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      /end date is before the start date/,
    );
    expect(errors).toEqual([]);
  });

  test("the audit log lists changes newest first, filtered by area", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/admin");
    await page
      .getByRole("navigation", { name: "Hostel office" })
      .getByRole("link", { name: "Audit log" })
      .click();
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    await page.getByLabel("Area").selectOption("settings");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/\/admin\/audit\?area=settings$/);
    const entries = page.getByRole("list", { name: "Audit log" }).getByRole("listitem");
    // The kiosk test above saved settings twice; its last save switched quiet hours off.
    await expect(entries.first()).toContainText("Settings");
    await expect(entries.first()).toContainText("kiosks always on");
    await expect(entries.first()).toContainText("By Asha Rawat (Admin)");
    await designMatrix(page, "audit-log");

    // The area is remembered; Clear forgets it.
    await page.goto("/admin/audit");
    await expect(page.getByLabel("Area")).toHaveValue("settings");
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByLabel("Area")).toHaveValue("");

    await page.goto("/admin/audit?q=nobody-did-this");
    await expect(page.getByText("No changes match these filters.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a student's record: header, tabs, and the office's scope", async ({ page, browser }) => {
    const errors = watchForErrors(page);
    const stamp = String(Date.now()).slice(-8);
    const people = [
      { name: `Recordrow Hostel ${stamp.slice(-4)}`, id: `26${stamp}`, hostel: "Hostel 3" },
      { name: `Recordrow Nowhere ${stamp.slice(-4)}`, id: `25${stamp}`, hostel: null },
    ];
    const urls: string[] = [];
    try {
      for (const person of people) {
        await page.goto("/admin/people");
        const add = page.getByRole("dialog", { name: "Add a person" });
        await openDialog(page.getByRole("button", { name: "Add a person" }), add);
        await add.getByLabel("Name", { exact: true }).fill(person.name);
        await add.getByLabel("Student ID", { exact: true }).fill(person.id);
        if (person.hostel) {
          await add.getByLabel("Hostel (optional)").selectOption({ label: person.hostel });
        }
        await add.getByRole("button", { name: "Add and email link" }).click();
        await expect(add).toBeHidden();

        // Their name in People opens the record.
        await page.goto(`/admin/people?q=${person.id}`);
        // A click while People hydrates is swallowed by the link (no navigation starts), so
        // click again while still on the list. The first visit compiles the record route in
        // the dev server (slow on CI runners), hence the long overall budget.
        const link = page.getByRole("link", { name: person.name });
        await expect(async () => {
          if (!UUID.test(page.url())) await link.click({ timeout: 2_000 });
          await expect(page).toHaveURL(UUID, { timeout: 10_000 });
        }).toPass({ timeout: 45_000 });
        urls.push(new URL(page.url()).pathname);
      }

      const [mine, elsewhere] = urls as [string, string];
      await page.goto(mine);
      await expect(page.getByRole("heading", { name: people[0]!.name, level: 1 })).toBeVisible();
      await expect(page.getByText("In the hostel", { exact: true })).toBeVisible();
      await expect(page.getByText(/Hostel 3/).first()).toBeVisible();
      await expect(current(page, "Record")).toHaveText("Outings");
      await expect(page.getByText("No outings in your hostels yet.")).toBeVisible();
      await designMatrix(page, "student-record");
      const tabs = page.getByRole("navigation", { name: "Record" });
      await tabs.getByRole("link", { name: "Requests", exact: true }).click();
      await expect(page).toHaveURL(/\?show=requests$/);
      await expect(page.getByText("No outing requests.")).toBeVisible();
      await tabs.getByRole("link", { name: "Gate scans", exact: true }).click();
      await expect(page).toHaveURL(/\?show=scans$/);
      await expect(page.getByText("No gate scans.")).toBeVisible();

      // Not a record: a malformed id, or one that isn't a student's.
      const seen = errors.length;
      for (const path of [
        "/admin/people/not-an-id",
        "/admin/people/7a1b2c3d-0000-4000-8000-0000000000cc",
      ]) {
        expect((await page.goto(path))?.status(), path).toBe(404);
      }
      // Those two 404s were asked for: drop what they logged, keep anything from before.
      errors.length = seen;

      // The warden of Hostel 3 sees their own student's record, not another one's.
      const warden = await asWho(browser, WARDEN_STATE);
      try {
        expect((await warden.page.goto(mine))?.status()).toBe(200);
        await expect(
          warden.page.getByRole("heading", { name: people[0]!.name, level: 1 }),
        ).toBeVisible();
        expect((await warden.page.goto(elsewhere))?.status()).toBe(404);
        await expect(warden.page.getByRole("heading", { name: people[1]!.name })).toHaveCount(0);
      } finally {
        await warden.close();
      }
    } finally {
      // Remove the people this test added (they never set up an account).
      for (const person of people) {
        await page.goto(`/admin/people?q=${person.id}`);
        const row = page.getByRole("listitem").filter({ hasText: person.name });
        const cancel = row.getByRole("button", { name: `Cancel invite: ${person.name}` });
        // Not added (the test failed first): nothing to remove.
        const added = await cancel
          .waitFor({ timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (!added) continue;
        const dialog = page.getByRole("dialog", { name: `Cancel ${person.name}'s invite?` });
        await openDialog(cancel, dialog);
        await dialog.getByRole("button", { name: "Cancel invite" }).click();
        await expect(
          page.getByText("Invite cancelled. The emailed set-up link no longer works."),
        ).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  });
});

test.describe("as a warden", () => {
  test.use({ storageState: WARDEN_STATE });

  test("the audit log isn't theirs", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page
        .getByRole("navigation", { name: "Hostel office" })
        .getByRole("link", { name: "Audit log" }),
    ).toHaveCount(0);
    expect((await page.goto("/admin/audit"))?.status()).toBe(404);
  });
});

test.describe("as a student", () => {
  test.use({ storageState: STUDENT_STATE });

  test("neither the audit log nor a record exists", async ({ page }) => {
    for (const path of ["/admin/audit", "/admin/people/7a1b2c3d-0000-4000-8000-0000000000cc"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});
