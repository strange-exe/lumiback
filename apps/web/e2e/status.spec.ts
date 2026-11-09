import { readdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { ADMIN_STATE, DEVELOPER_STATE, WARDEN_STATE } from "../playwright.config";
import changelog from "../src/lib/changelog.json";
import { designMatrix, watchForErrors } from "./helpers";

// The developer's Status page: which API and website build is running, and whether the
// database has every migration. Developers only (a 404 for everyone else, like setup pages for
// a warden), never while viewing as a role, and nothing secret on it.

const officeNav = (page: Page) => page.getByRole("navigation", { name: "Hostel office" });

/** The newest migration's revision (files are named <date>_<revision>_<slug>.py, in order). */
const HEAD = readdirSync(path.join(__dirname, "../../../backend/migrations/versions"))
  .map((f) => /^\d{8}_(\d{4})_.+\.py$/.exec(f)?.[1])
  .filter((r): r is string => r !== undefined)
  .sort()
  .at(-1);

/** The developer's own session (signed in once, in auth.setup.ts), in a fresh context. */
async function asDeveloper(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: DEVELOPER_STATE });
  return context.newPage();
}

test("a developer sees the API, database and website status", async ({ browser }) => {
  const page = await asDeveloper(browser);
  const errors = watchForErrors(page);
  try {
    await page.goto("/admin");
    await officeNav(page).getByRole("link", { name: "Status" }).click();
    await expect(page).toHaveURL(/\/admin\/status$/);
    await expect(page.getByRole("heading", { name: "Status", level: 1 })).toBeVisible();

    const api = page.getByRole("region", { name: "API" });
    await expect(api.getByText("0.1.0", { exact: true })).toBeVisible();
    await expect(api).toContainText("Not reported");
    await expect(api).toContainText("Reachable");
    await expect(api).toContainText("Up to date");
    expect(HEAD).toBeDefined();
    await expect(api).toContainText(`Up to date (${HEAD})`);

    const web = page.getByRole("region", { name: "Website" });
    await expect(web.getByText(changelog[0]!.version, { exact: true })).toBeVisible();
    await expect(web).toContainText("Not reported");

    // Nothing that looks like an address, a key or a setting.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const secret of [
      "http://",
      "https://",
      "127.0.0.1",
      "localhost",
      "8100",
      "secret",
      "token",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    await designMatrix(page, "status");
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
});

// The test API logs pushes instead of sending them (scripts/e2e_server.py): no phone is reached.
test("a developer announces an update, confirmed first, twice in a row", async ({ browser }) => {
  const page = await asDeveloper(browser);
  const errors = watchForErrors(page);
  try {
    await page.goto("/admin/status");
    const form = page.getByRole("region", { name: "Announce an update" });
    // Starts with the current release's title and summary (changelog.json), ready to edit.
    const current: { title: string; summary?: string } = changelog[0]!;
    await expect(form.getByLabel("Title")).toHaveValue(current.title);
    await expect(form.getByLabel("What's new")).toHaveValue(current.summary ?? "");
    await form.getByLabel("Title").fill("Lumiback has been updated");
    await form.getByLabel("What's new").fill("Running late? Move your due-back time once.");
    await form.getByRole("button", { name: "Announce" }).click();
    const confirm = page.getByRole("dialog", { name: "Send this to every phone with Lumiback?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Send to every phone" }).click();
    // The answer's body is read (a 202 used to arrive empty and the success showed as an error).
    await expect(
      form.getByText(/^(Sending to \d+ phones?|Announced, but no phones)/),
    ).toBeVisible();
    await expect(form.getByRole("alert")).toHaveText(""); // always there, empty: no error

    // A sent announcement clears the form, and a second one right after is sent too (owner,
    // 2026-11-09: "No timeout in announcements, it's just better for dev").
    await expect(form.getByLabel("Title")).toHaveValue("");
    await expect(form).not.toContainText(/once a day|again after/i);
    await form.getByLabel("Title").fill("Lumiback has been updated again");
    await form.getByLabel("What's new").fill("One more thing.");
    await form.getByRole("button", { name: "Announce" }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Send to every phone" }).click();
    await expect(confirm).toBeHidden();
    // Sent again: the form empties once more and no refusal shows.
    await expect(form.getByLabel("Title")).toHaveValue("");
    await expect(form.getByRole("alert")).toHaveText("");
    await expect(
      form.getByText(/^(Sending to \d+ phones?|Announced, but no phones)/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
});

test("while viewing as a role, Status is that role's: gone", async ({ browser }) => {
  const page = await asDeveloper(browser);
  try {
    await page.goto("/admin");
    await officeNav(page).getByRole("button", { name: "View as" }).click();
    await page.getByRole("menuitemradio", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("region", { name: "Viewing as" })).toBeVisible();
    await expect(officeNav(page).getByRole("link", { name: "Status" })).toHaveCount(0);
    expect((await page.goto("/admin/status"))?.status()).toBe(404);
  } finally {
    await page.context().close();
  }
});

for (const [who, state] of [
  ["an admin", ADMIN_STATE],
  ["a warden", WARDEN_STATE],
] as const) {
  test(`${who} gets a 404 and no Status link`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: state });
    const page = await context.newPage();
    try {
      await page.goto("/admin");
      await expect(officeNav(page).getByRole("link", { name: "People" })).toBeVisible();
      await expect(officeNav(page).getByRole("link", { name: "Status" })).toHaveCount(0);
      expect((await page.goto("/admin/status"))?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });
}
