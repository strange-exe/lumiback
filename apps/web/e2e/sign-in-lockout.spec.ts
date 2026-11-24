import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";
import { watchForErrors } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("5 wrong passwords in a row offer a password reset for that email", async ({ page }) => {
  const errors = watchForErrors(page);
  // An email with no account: the lockout looks the same either way, and no seeded account
  // gets locked for the specs after this one.
  const email = `locked-${Date.now()}@geu.ac.in`;
  await page.goto("/sign-in");
  await page.getByLabel("University email").fill(email);
  const form = page.getByRole("region", { name: "Sign in" });
  const problem = form.getByRole("alert"); // not Next's route announcer, also an alert
  const password = page.getByLabel("Password", { exact: true });
  const locked = page.getByRole("dialog", { name: "Forgot your password?" });

  /** One try; done once the form resets (the password is never handed back). */
  const tryPassword = async (value: string): Promise<void> => {
    await password.fill(value);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(password).toHaveValue("");
  };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await tryPassword(`wrong-password-${attempt}`);
    await expect(problem).toHaveText("Invalid email or password");
    await expect(locked).toBeHidden();
  }
  await tryPassword("wrong-password-5");

  await expect(locked).toBeVisible();
  const reset = locked.getByRole("link", { name: "Reset password" });
  await expect(reset).toBeFocused();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
      .toBe(scheme === "dark");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations, `${scheme}: ${axe.violations.map((v) => v.id).join(", ")}`).toEqual([]);
  }

  // Not now closes it and leaves the reason on the page.
  await locked.getByRole("button", { name: "Not now" }).click();
  await expect(locked).toBeHidden();
  await expect(problem).toContainText("Too many wrong passwords");

  // The next try (right or wrong) is still paused and offers the reset again.
  await tryPassword("wrong-password-6");
  await expect(locked).toBeVisible();
  await locked.getByRole("link", { name: "Reset password" }).click();

  await expect(page).toHaveURL(/\/forgot-password\?email=/);
  await expect(page.getByLabel("University email")).toHaveValue(email);
  expect(errors).toEqual([]);
});
