import { expect, test } from "@playwright/test";

import { checkOut, ensureIn, signIn, STUDENT } from "./helpers";

const SIGNED_OUT = { cookies: [], origins: [] };

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("protected pages send visitors to sign in", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL("http://localhost:3000/sign-in");
    await page.goto("/history");
    await expect(page).toHaveURL("http://localhost:3000/sign-in");
  });

  test("wrong password shows a calm, generic error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("University email").fill(STUDENT.email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    const form = page.getByRole("region", { name: "Sign in" });
    await expect(form.getByRole("alert")).toHaveText("Invalid email or password");
    // The form resets after its action; only the password should need typing again.
    await expect(form.getByLabel("University email")).toHaveValue(STUDENT.email);
    await expect(form.getByLabel("Password", { exact: true })).toHaveValue("");
  });

  test("the password can be shown while typing", async ({ page }) => {
    await page.goto("/sign-in");
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("check-my-typing");
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("check-my-typing");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("forgot password: ask for a code, a wrong code is refused", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await page.getByLabel("University email").fill(STUDENT.email);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expect(page.getByText(`If ${STUDENT.email} has an account`)).toBeVisible();

    await page.getByLabel("Code").fill("000000");
    await page.getByLabel("New password", { exact: true }).fill("a-brand-new-passphrase");
    await page.getByRole("button", { name: "Set new password" }).click();
    const form = page.getByRole("region", { name: "Check your inbox" });
    await expect(form.getByRole("alert")).toHaveText("Invalid or expired code");
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
    await expect(page).toHaveURL("http://localhost:3000/sign-in");
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

test("the hostel's rules set the return time, and it can't be extended", async ({ page }) => {
  await ensureIn(page);
  // The e2e default rules: open all day, back by 11:59 PM (backend/scripts/e2e_server.py).
  await expect(page.getByRole("region", { name: /outings: 12:00 AM–11:59 PM/ })).toBeVisible();
  await expect(page.getByText("Back by 11:59 PM.", { exact: false }).first()).toBeVisible();
  await checkOut(page, "Robbers Cave");
  await expect(page.getByText("11:59", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Running late? Update your time")).toHaveCount(0);
  await ensureIn(page);
});

test("the server renders today's rules without clock-dependent text", async ({ page }) => {
  await ensureIn(page);
  const html = await (await page.request.get("/home")).text();
  expect(html).toContain("Back by 11:59 PM"); // from the rules, not from a clock
  expect(html).not.toContain("close in"); // countdowns would disagree with hydration
});
