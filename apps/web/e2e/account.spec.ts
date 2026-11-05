import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { STUDENT } from "./helpers";

const SIGNED_OUT = { cookies: [], origins: [] };
/** Seeded only so this test can delete it (backend/scripts/e2e_server.py). */
const DELETABLE = { email: "e2e-delete@geu.ac.in", password: STUDENT.password };

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("installable: manifest and icons are served", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as {
      name: string;
      display: string;
      icons: { src: string; purpose: string }[];
    };
    expect(body).toMatchObject({ name: "Lumiback", display: "standalone" });
    expect(body.icons.map((i) => i.purpose).sort()).toEqual(["any", "any", "maskable"]);
    for (const icon of [...body.icons.map((i) => i.src), "/apple-icon.png"]) {
      const response = await request.get(icon);
      expect(response.headers()["content-type"], icon).toContain("image/png");
    }
  });

  test("the privacy notice is public and linked from sign-up", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("link", { name: "privacy notice" }).click();
    await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How long we keep it" })).toBeVisible();
  });

  test("the data export needs a signed-in visitor", async ({ request }) => {
    const response = await request.get("/api/account/export", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(response.status()).toBe(401);
  });

  test("deleting an account needs the password, then erases it for good", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("University email").fill(DELETABLE.email);
    await page.getByLabel("Password", { exact: true }).fill(DELETABLE.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/home$/);

    await page.getByRole("link", { name: "Account" }).click();
    await expect(page.getByText(DELETABLE.email)).toBeVisible();
    await page.getByText("Delete account").click();

    const form = page.locator("details form");
    await form.getByLabel("Password", { exact: true }).fill("not-my-password-1");
    await form.getByLabel('Type "delete" to confirm').fill("delete");
    await form.getByRole("button", { name: "Delete my account" }).click();
    await expect(form.getByRole("alert")).toHaveText("That password isn't right");

    await form.getByLabel("Password", { exact: true }).fill(DELETABLE.password);
    await form.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText("Your account and all its data were deleted.")).toBeVisible();

    await page.getByLabel("University email").fill(DELETABLE.email);
    await page.getByLabel("Password", { exact: true }).fill(DELETABLE.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid email or password");
  });
});

test("download my data saves the student's own records as JSON", async ({ page }) => {
  await page.goto("/account");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^lumiback-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync(await file.path(), "utf8")) as {
    format: string;
    account: { email: string };
    outings: unknown[];
  };
  expect(data.format).toBe("lumiback-export");
  expect(data.account.email).toBe(STUDENT.email);
  expect(Array.isArray(data.outings)).toBe(true);
  await expect(page.getByText("Downloaded. Check your downloads folder.")).toBeVisible();
});
