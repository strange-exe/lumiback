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

  test("deleting an account needs the password, then erases it for good", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("University email").fill(DELETABLE.email);
    await page.getByLabel("Password").fill(DELETABLE.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/home$/);

    await page.getByRole("link", { name: "Account" }).click();
    await expect(page.getByText(DELETABLE.email)).toBeVisible();
    await page.getByText("Delete account").click();

    const form = page.locator("details form");
    await form.getByLabel("Password").fill("not-my-password-1");
    await form.getByLabel('Type "delete" to confirm').fill("delete");
    await form.getByRole("button", { name: "Delete my account" }).click();
    await expect(form.getByRole("alert")).toHaveText("That password isn't right");

    await form.getByLabel("Password").fill(DELETABLE.password);
    await form.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText("Your account and all its data were deleted.")).toBeVisible();

    await page.getByLabel("University email").fill(DELETABLE.email);
    await page.getByLabel("Password").fill(DELETABLE.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Invalid email or password");
  });
});
