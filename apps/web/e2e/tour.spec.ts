import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ADMIN_STATE } from "../playwright.config";
import changelog from "../src/lib/changelog.json";
import { ensureIn, watchForErrors } from "./helpers";

/** The site's version: the newest changelog entry. */
const CURRENT = changelog[0]!.version;

/**
 * Automated browsers don't get the tour unless they opt in (features/tour/store.ts), so the
 * rest of the suite never meets it. Each test here starts from the signed-in storage state,
 * whose localStorage has no "seen" version: a first visit.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("lb-tour-under-test", "1"));
});

const tourStatus = (page: Page) => page.locator("[data-tour-status]");
const dialog = (page: Page) => page.locator("dialog[data-tour-dialog]");

/** The step the tour shows now (its data-step), once it's settled on one. */
async function stepId(page: Page): Promise<string> {
  await expect(dialog(page)).toHaveAttribute("data-state", "open");
  return (await dialog(page).getAttribute("data-step")) ?? "";
}

async function seenKey(page: Page): Promise<string> {
  const key = await page.evaluate(() =>
    Object.keys(window.localStorage).find((k) => k.startsWith("lb-tour-seen:")),
  );
  expect(key, "the tour stores the version it was shown for").toBeTruthy();
  return key!;
}

test.describe("student", () => {
  test("the first visit walks through every step to Done, and not again after a reload", async ({
    page,
  }) => {
    // Today shows the board and the check-out form only while "in". A second page (without
    // this test's opt-in script, and loaded before it ever runs) gets there first.
    const setup = await page.context().newPage();
    await ensureIn(setup);
    await setup.close();

    const errors = watchForErrors(page);
    await page.goto("/home");

    const tour = page.getByRole("dialog", { name: "Your status" });
    await expect(tour).toBeVisible();
    await expect(tour).toHaveAttribute("aria-modal", "true");
    await expect(tour).toContainText("Quick tour");
    await expect(tour).toContainText("1 of 5");
    // Focus moves into the dialog, onto Next.
    await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();

    const seen: string[] = [await stepId(page)];
    while (await dialog(page).getByRole("button", { name: "Next" }).isVisible()) {
      await dialog(page).getByRole("button", { name: "Next" }).click();
      await expect(dialog(page)).not.toHaveAttribute("data-step", seen[seen.length - 1]!);
      seen.push(await stepId(page));
    }
    expect(seen).toEqual(["status", "checkout", "history", "share", "account"]);
    await expect(dialog(page)).toContainText("5 of 5");
    // Back goes one step back, and the step change is announced.
    await dialog(page).getByRole("button", { name: "Back" }).click();
    await expect(dialog(page)).toHaveAttribute("data-step", "share");
    await expect(dialog(page).locator("[aria-live]")).toContainText("4 of 5. Share.");
    await dialog(page).getByRole("button", { name: "Next" }).click();
    await dialog(page).getByRole("button", { name: "Done" }).click();

    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "done");
    await expect(dialog(page)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), await seenKey(page))).toBe(CURRENT);

    await page.reload();
    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "none");
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Escape skips the tour, and Tab stays inside it", async ({ page }) => {
    await page.goto("/home");
    await expect(dialog(page)).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(
          () => document.activeElement?.closest("dialog[data-tour-dialog]") != null,
        ),
        "focus stays in the tour",
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "done");
    // The page works again: its links take clicks.
    await page.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/\/history$/);
  });

  test("after an update, only what changed since the seen version", async ({ page }) => {
    await page.goto("/home");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "done");

    const key = await seenKey(page);
    await page.evaluate((k) => localStorage.setItem(k, "1.12.1"), key);
    await page.reload();

    const tour = dialog(page);
    await expect(tour).toBeVisible();
    await expect(tour).toContainText(`New in ${CURRENT}`);
    await expect(tour).toContainText("1 of 3");
    const steps = [await stepId(page)];
    for (let i = 0; i < 2; i++) {
      await tour.getByRole("button", { name: "Next" }).click();
      await expect(tour).not.toHaveAttribute("data-step", steps[i]!);
      steps.push(await stepId(page));
    }
    expect(steps).toEqual(["status", "history", "account"]);
    // After an update, a step that changed says what changed.
    await expect(tour).toContainText("Account has Take the tour again");
    await tour.getByRole("button", { name: "Done" }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(CURRENT);
  });

  test("Take the tour again from Account runs the whole tour from Today", async ({ page }) => {
    await page.goto("/home");
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Skip the tour" }).click();
    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "done");

    await page.getByRole("link", { name: "Account" }).click();
    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Take the tour again" }).click();
    await expect(page).toHaveURL(/\/home$/);
    const tour = page.getByRole("dialog", { name: "Your status" });
    await expect(tour).toBeVisible();
    await expect(tour).toContainText("Quick tour");
  });

  test("reduced motion: the tour opens and closes without waiting on animation", async ({
    page,
  }) => {
    await page.goto("/home");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    await expect(dialog(page)).toBeVisible();
    const animated = await page
      .locator(".tour-card")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animated).toBe("none");
    await dialog(page).getByRole("button", { name: "Skip the tour" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("axe finds no issues with the tour open", async ({ page }) => {
    await page.goto("/home");
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator(".tour-card")).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe("hostel office", () => {
  test.use({ storageState: ADMIN_STATE });

  test("staff get their own tour on the register, replayable from the header", async ({ page }) => {
    await page.goto("/admin");
    const tour = page.getByRole("dialog", { name: "The register" });
    await expect(tour).toBeVisible();
    await expect(tour).toContainText("1 of 6");
    await page.keyboard.press("Escape");
    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "done");

    await page.getByRole("button", { name: "Take the tour again" }).click();
    await expect(page.getByRole("dialog", { name: "The register" })).toBeVisible();
  });

  test("staff don't get the student tour in the student pages", async ({ page }) => {
    await page.goto("/home");
    await expect(tourStatus(page)).toHaveAttribute("data-tour-status", "off");
    await expect(dialog(page)).toHaveCount(0);
  });
});
