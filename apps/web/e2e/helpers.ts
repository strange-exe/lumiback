import { expect, type Page } from "@playwright/test";

/** Seeded by backend/scripts/e2e_server.py into the local *_test database only. */
export const STUDENT = { email: "e2e@geu.ac.in", password: "lantern-at-dusk-2029" };

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("University email").fill(STUDENT.email);
  await page.getByLabel("Password").fill(STUDENT.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Make sure the student starts "in" (tests share one account). */
export async function ensureIn(page: Page): Promise<void> {
  await page.goto("/home");
  const back = page.getByRole("button", { name: "I'm back" });
  if (await back.isVisible()) {
    await back.click();
    await expect(page.getByRole("heading", { name: "Heading out?" })).toBeVisible();
  }
}

export async function checkOut(page: Page, destination: string): Promise<void> {
  await ensureIn(page);
  await page.getByRole("radio", { name: "+1 h" }).check({ force: true });
  await page.getByLabel("Where to? (optional)").fill(destination);
  await page.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByRole("heading", { name: destination })).toBeVisible();
}

/** Collects console errors and failed requests for a page. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}
