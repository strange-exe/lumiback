import { expect, test } from "@playwright/test";

import { ADMIN_STATE } from "../playwright.config";
import { watchForErrors } from "./helpers";

// Admins add people from a CSV, and send password links. The emailed link itself is covered
// by the backend tests; here: the pages, and a link that doesn't work.

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("checks a CSV, then adds the new people", async ({ page }) => {
    const errors = watchForErrors(page);
    const id = `29${String(Date.now()).slice(-8)}`;
    const csv = [
      "index,student_id,name,phone number,parent's name,number,hostel,role",
      `1,${id},Isha Rao,98765 43210,Ravi Rao,91234 56789,,`,
      "2,,<img src=x onerror=alert(1)>,,,,,", // no student ID: a problem row
      "3,,Meera Head,,,,,principal", // not a role: a problem row
    ].join("\n");

    await page.goto("/admin/people");
    await page.getByRole("link", { name: /add people from a csv/i }).click();
    await expect(page).toHaveURL(/\/admin\/people\/import$/);
    await page.getByLabel("CSV file").setInputFiles({
      name: "people.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: /check file/i }).click();
    await expect(page.getByText("Checked. Nothing is added yet.")).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByText("Isha Rao")).toBeVisible();
    // The name is shown as text, never run as HTML.
    await expect(table.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    await expect(page.locator("img[src='x']")).toHaveCount(0);

    await page.getByRole("button", { name: /^add 1 /i }).click();
    await expect(page.getByText(/^Added 1\./)).toBeVisible();

    await page.goto(`/admin/people?q=${id}`);
    await expect(page.getByText("Invited, not set up")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send password link" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a set-password link that doesn't work says so and offers Forgot password", async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await page.goto(`/set-password#t=${"x".repeat(43)}`);
    await expect(page.getByText(/expired or was already used/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();
    expect(page.url()).not.toContain("#t="); // the token leaves the address bar
    expect(errors).toEqual([]);
  });

  test("with no link at all", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/set-password");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
