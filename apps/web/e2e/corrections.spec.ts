import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "./fixtures";

import { ADMIN_STATE } from "../playwright.config";
import { istInputValue } from "../src/features/outings/time";
import { checkOut, ensureIn, watchForErrors } from "./helpers";

// Outing corrections: a student asks the hostel office (who approves), and the office records
// a return itself from the register. The rules and their limits are covered by the backend's
// tests/test_corrections.py; here: the pages, end to end. Tests share one student account, so
// each one leaves the student checked in.

const XSS = "<img src=x onerror=alert(1)>";

/** Any alert() would mean a reason ran as HTML. */
function watchDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

/** WCAG A/AA problems on the page as it is now (forms open, dialogs shown). */
async function axeProblems(page: Page): Promise<string[]> {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return axe.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}

/**
 * For review only: CORRECTION_SHOTS=<dir> saves the current state at desktop and phone width,
 * light and dark (the design matrix in design.spec.ts covers the empty states).
 */
async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.CORRECTION_SHOTS;
  if (!dir) return;
  const size = page.viewportSize();
  for (const [label, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
        scheme === "dark",
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `no horizontal scrolling (${label})`).toBe(false);
      // No transitions: switching the colour scheme fades colours, which would be captured midway.
      await page.screenshot({
        path: `${dir}/${name}-${label}-${scheme}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  if (size) await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: null });
}

async function asOffice(browser: Browser): Promise<{ office: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const office = await context.newPage();
  return { office, close: () => context.close() };
}

test.afterEach(async ({ page }) => {
  // Wait for Today to show one of its two states first (isVisible() in ensureIn doesn't wait,
  // and the page streams in after a loading skeleton).
  await page.goto("/home");
  await expect(
    page
      .getByRole("button", { name: "I'm back" })
      .or(page.getByRole("heading", { name: "Heading out?" })),
  ).toBeVisible();
  await ensureIn(page);
});

test("a student asks for a correction, the office approves it, and the student sees it", async ({
  page,
  browser,
}) => {
  const errors = watchForErrors(page);
  const alerts = watchDialogs(page);
  const place = `Forgot ${Date.now()}`;
  await checkOut(page, place);

  // Today offers the form for this outing, already open on History.
  await page.getByRole("link", { name: "Forgot to tap in?" }).click();
  await expect(page).toHaveURL(/\/history\?fix=/);
  const item = page.getByRole("listitem").filter({ hasText: place });
  await expect(item.getByRole("group", { name: "What's wrong?" })).toBeVisible();
  await expect(item.getByLabel("I'm back, I forgot to tap in")).toBeChecked();
  await expect(item.getByLabel("When did you come back? (IST)")).toHaveValue(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  );
  // "This trip didn't happen" needs no time.
  await item.getByLabel("This trip didn't happen").check();
  await expect(item.getByLabel("When did you come back? (IST)")).toHaveCount(0);
  await item.getByLabel("I'm back, I forgot to tap in").check();

  await item.getByLabel("What happened?").fill(XSS);
  expect(await axeProblems(page), "accessibility of the open form").toEqual([]);
  await shoot(page, "history-form");
  await item.getByRole("button", { name: "Send to the hostel office" }).click();
  await expect(item.getByText("Waiting for the hostel office")).toBeVisible();
  await expect(item.getByText(/^You said you came back at/)).toBeVisible();
  await expect(item.getByText("Something wrong?")).toHaveCount(0); // one ask at a time
  await shoot(page, "history-waiting");
  await page.goto("/home");
  await expect(page.getByText(/Waiting for their answer/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot to tap in?" })).toHaveCount(0);

  const { office, close } = await asOffice(browser);
  const officeErrors = watchForErrors(office);
  const officeAlerts = watchDialogs(office);
  await office.goto("/admin");
  await expect(office.getByRole("link", { name: /to correct/ })).toBeVisible();
  await office.getByRole("link", { name: "Corrections", exact: true }).click();
  await expect(office.getByRole("heading", { name: "Corrections", level: 1 })).toBeVisible();
  const card = office.getByRole("article").filter({ hasText: XSS });
  // The reason is shown as text, never run as HTML.
  await expect(card.getByText(XSS)).toBeVisible();
  await expect(office.locator("img[src='x']")).toHaveCount(0);
  await expect(card.getByText(/^They came back at/)).toBeVisible();
  expect(await axeProblems(office), "accessibility of the corrections page").toEqual([]);
  await shoot(office, "admin-corrections");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toHaveCount(0);
  expect(officeErrors).toEqual([]);
  expect(officeAlerts).toEqual([]);
  await close();

  // The office's change is on the student's record, and they're back in.
  await page.goto("/history");
  const after = page.getByRole("listitem").filter({ hasText: place });
  await expect(after.getByText("Return recorded by the hostel office")).toBeVisible();
  await expect(after.getByText("Waiting for the hostel office")).toHaveCount(0);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Heading out?" })).toBeVisible();
  expect(errors).toEqual([]);
  expect(alerts).toEqual([]);
});

test("the office records a student's return from the register", async ({ page, browser }) => {
  const place = `Register ${Date.now()}`;
  await checkOut(page, place);

  const { office, close } = await asOffice(browser);
  const officeErrors = watchForErrors(office);
  await office.goto("/admin");
  const row = office.getByRole("row").filter({ hasText: place });
  const open = row.getByRole("button", { name: /^Record return/ });
  const dialog = office.getByRole("dialog");

  // Escape closes the dialog and gives focus back to its button.
  await open.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /^Record return: / })).toBeVisible();
  await office.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  const time = dialog.getByLabel("Came back at (IST)");
  await expect(time).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  const now = await time.inputValue();
  await dialog.getByLabel("Reason").fill("Phone died, seen at the desk");

  // A time that hasn't come yet: the server's own explanation, and nothing changes.
  await time.fill(istInputValue(new Date(Date.now() + 86_400_000)));
  await dialog.getByRole("button", { name: "Record return" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(/hasn't come yet/);
  await expect(row).toHaveCount(1);
  expect(await axeProblems(office), "accessibility of the dialog").toEqual([]);
  await shoot(office, "register-dialog");

  await time.fill(now);
  await dialog.getByRole("button", { name: "Record return" }).click();
  await expect(row).toHaveCount(0);
  expect(officeErrors).toEqual([]);
  await close();

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Heading out?" })).toBeVisible();
  await page.goto("/history");
  const item = page.getByRole("listitem").filter({ hasText: place });
  await expect(item.getByText("Return recorded by the hostel office")).toBeVisible();
  await shoot(page, "history-recorded");
});
