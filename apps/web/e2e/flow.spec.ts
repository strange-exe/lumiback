import { expect, test } from "@playwright/test";

import { checkOut, ensureIn, signIn, STUDENT } from "./helpers";

const SIGNED_OUT = { cookies: [], origins: [] };

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("protected pages send visitors to sign in", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL("http://localhost:3000/");
    await page.goto("/history");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("wrong password shows a calm, generic error", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("University email").fill(STUDENT.email);
    await page.getByLabel("Password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    const form = page.getByRole("region", { name: "Sign in" });
    await expect(form.getByRole("alert")).toHaveText("Invalid email or password");
  });

  test("tokens live only in httpOnly cookies", async ({ page, context }) => {
    await signIn(page);
    const cookies = await context.cookies();
    const auth = cookies.filter((c) => c.name.startsWith("outing_"));
    expect(auth.map((c) => c.name).sort()).toEqual(["outing_at", "outing_rt"]);
    for (const cookie of auth) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
    }
    const visibleToScripts = await page.evaluate(() => document.cookie);
    expect(visibleToScripts).not.toContain("outing_");
  });

  test("sign out clears the session", async ({ page, context }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("http://localhost:3000/");
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).not.toContain("outing_rt");
    await page.goto("/home");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});

test("check out, see the return arc, come back, find it in history", async ({ page }) => {
  await checkOut(page, "Paltan Bazaar");

  await expect(page.getByText("Back by", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /due back at/ })).toBeVisible();

  await page.getByRole("button", { name: "I'm back" }).click();
  await expect(page.getByRole("heading", { name: "Heading out?" })).toBeVisible();

  await page.getByRole("link", { name: "History" }).click();
  const latest = page.getByRole("listitem").first();
  await expect(latest).toContainText("Paltan Bazaar");
  await expect(latest).toContainText("On time");
});

test("running late: update the return time", async ({ page }) => {
  await checkOut(page, "Robbers Cave");
  await page.getByText("Running late? Update your time").click();
  await page.getByRole("radio", { name: "+3 h" }).check({ force: true });
  await page.getByRole("button", { name: "Update return time" }).click();
  await expect(page.getByRole("heading", { name: "Robbers Cave" })).toBeVisible();
  await ensureIn(page);
});

test("the server never renders clock-dependent text that hydration could disagree with", async ({
  page,
}) => {
  await ensureIn(page);
  const html = await (await page.request.get("/home")).text();
  expect(html).toContain("When will you be back?");
  expect(html).not.toMatch(/Back by/); // computed from the browser's clock after mount
  await expect(page.getByText(/^Back by/)).toBeVisible();
});
