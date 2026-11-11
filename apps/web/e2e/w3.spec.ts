import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "./fixtures";

import { ADMIN_STATE, STUDENT_STATE } from "../playwright.config";
import { formatTime } from "../src/features/outings/time";
import {
  allowLocation,
  API,
  checkOut,
  ensureIn,
  newJoinCode,
  startSharing,
  stopSharing,
  stubMapTiles,
  watchForErrors,
} from "./helpers";

// Wave 3 on the website: "Running late?" (student, then the office's register) and followers
// seeing the student's due-back time. The rules (once per outing, 15/30/60, until the late
// alert) are covered by the backend's tests; here: the pages. Lean on purpose: sessions expire
// at 15 minutes and the full suite is already long.

const SHARER = "Riya Sharma"; // the seeded e2e student
const SIGNED_OUT = { cookies: [], origins: [] };

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

interface Current {
  expected_return_at: string;
  original_return_at: string | null;
  running_late_choices: number[];
}

async function current(request: APIRequestContext): Promise<Current> {
  const response = await request.get(`${API}/outings/current`, { headers: asStudent() });
  expect(response.ok()).toBe(true);
  return (await response.json()) as Current;
}

/** The due time moved by `minutes`, as the page shows it. */
function later(iso: string, minutes: number): string {
  return formatTime(new Date(Date.parse(iso) + minutes * 60_000));
}

/** Clicks a button that opens a dialog by script until it shows (a click before hydration does nothing). */
async function openDialog(button: Locator, dialog: Locator): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

test.describe("running late", () => {
  test("a student moves their due time once, and the office sees it with the reason", async ({
    page,
    browser,
    request,
  }) => {
    const errors = watchForErrors(page);
    try {
      await checkOut(page, "Running late check");
      const before = await current(request);
      expect(before.running_late_choices).toEqual([15, 30, 60]);
      const was = formatTime(before.expected_return_at);
      const now = later(before.expected_return_at, 30);

      const choose = page.getByRole("dialog", { name: "How much later will you be?" });
      await openDialog(page.getByRole("button", { name: "Running late?" }), choose);
      await choose.getByText("30 min", { exact: true }).click();
      await choose.getByLabel("Reason (optional)").fill("Bus is stuck in traffic");
      await choose.getByRole("button", { name: "Next" }).click();

      const confirm = page.getByRole("dialog", { name: "Move your due-back time?" });
      await expect(confirm).toContainText(
        `You'll be due back at ${now} instead of ${was}. You can only do this once per outing.`,
      );
      await confirm.getByRole("button", { name: "Tell the hostel office" }).click();

      await expect(page.getByText(`Due back ${now}, was ${was}.`, { exact: true })).toBeVisible();
      // Once per outing: no second go, after a reload too.
      await expect(page.getByRole("button", { name: "Running late?" })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(`Due back ${now}, was ${was}.`, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Running late?" })).toHaveCount(0);

      const office = await browser.newContext({ storageState: ADMIN_STATE });
      try {
        const register = await office.newPage();
        const officeErrors = watchForErrors(register);
        await register.goto("/admin");
        const row = register
          .getByRole("region", { name: "Who's out" })
          .getByRole("row")
          .filter({ hasText: SHARER });
        await expect(row).toContainText("Running late: 30 min more, was due");
        await expect(row).toContainText(was);
        await expect(row).toContainText(now);
        await expect(row).toContainText("Reason: Bus is stuck in traffic");
        expect(officeErrors).toEqual([]);
      } finally {
        await office.close();
      }
    } finally {
      await ensureIn(page);
    }
    expect(errors).toEqual([]);
  });
});

/** A friend with no account, in their own browser. */
async function guestPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: SIGNED_OUT });
  await stubMapTiles(context);
  return context.newPage();
}

test.describe("followers", () => {
  test("see the due-back time, and the earlier one after running late, never the reason", async ({
    page,
    browser,
    request,
  }) => {
    await allowLocation(page.context());
    await stubMapTiles(page.context());
    const guest = await guestPage(browser);
    const guestErrors = watchForErrors(guest);
    try {
      await checkOut(page, "Follow check");
      const out = await current(request);
      const due = formatTime(out.expected_return_at);
      await startSharing(page);
      const code = await newJoinCode(page);

      await guest.goto("/join");
      await guest.getByLabel("Join code").fill(code);
      await guest.getByLabel("Your name").fill("Maa");
      await guest.getByRole("button", { name: "Ask to follow along" }).click();
      await expect(guest).toHaveURL(/\/watch\/[0-9a-f-]{36}$/);
      await page.getByRole("button", { name: "Approve Maa (guest)" }).click({ timeout: 10_000 });
      await expect(guest.getByRole("heading", { name: `${SHARER}'s way back` })).toBeVisible();
      await expect(guest.getByText(`Due back ${due}.`, { exact: true })).toBeVisible();

      const moved = await request.post(`${API}/outings/current/running-late`, {
        headers: asStudent(),
        data: { minutes: 15, reason: "Private reason for the office" },
      });
      expect(moved.ok()).toBe(true);
      await guest.reload(); // the follow view reads the share's details when it connects
      await expect(
        guest.getByText(`Due back ${later(out.expected_return_at, 15)}, was ${due}.`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(guest.getByText("Private reason for the office")).toHaveCount(0);
    } finally {
      await stopSharing(page);
      await ensureIn(page);
      await guest.context().close();
    }
    expect(guestErrors).toEqual([]);
  });
});
