import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { ADMIN_STATE, WARDEN_STATE } from "../playwright.config";
import { watchForErrors } from "./helpers";

/**
 * The hostel office's pages on a phone and a desktop, light and dark, with the busy sample
 * hostel from `e2e_server.py --demo`. Run on its own:
 *   E2E_DEMO=1 npx playwright test e2e/office.spec.ts      (SHOTS=before for the baseline)
 */
test.skip(!process.env.E2E_DEMO, "needs the demo data: E2E_DEMO=1");
test.describe.configure({ timeout: 90_000 });

const SHOTS = `e2e/shots/${process.env.SHOTS ?? "after"}`;
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const SCHEMES = ["light", "dark"] as const;

const ADMIN_PAGES = [
  ["register", "/admin"],
  ["requests", "/admin/requests"],
  ["escalations", "/admin/escalations"],
  ["scans", "/admin/scans"],
  ["gates", "/admin/gates"],
  ["rules", "/admin/rules"],
  ["people", "/admin/people?q=demo"],
  ["settings", "/admin/settings"],
] as const;
const WARDEN_PAGES = [
  ["register", "/admin"],
  ["requests", "/admin/requests"],
  ["escalations", "/admin/escalations"],
  ["scans", "/admin/scans"],
  ["hostel", "/admin/hostel"],
] as const;

const ROLES = [
  { role: "admin", state: ADMIN_STATE, pages: ADMIN_PAGES },
  // The baseline predates wardens: their pages don't exist yet.
  ...(process.env.SHOTS === "before"
    ? []
    : [{ role: "warden", state: WARDEN_STATE, pages: WARDEN_PAGES }]),
];

for (const { role, state, pages } of ROLES) {
  test.describe(`as ${role}`, () => {
    test.use({ storageState: state });
    for (const [name, path] of pages) {
      for (const vp of VIEWPORTS) {
        for (const scheme of SCHEMES) {
          test(`${name} ${vp.name} ${scheme}`, async ({ page }) => {
            const errors = watchForErrors(page);
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
            await page.setViewportSize(vp);
            const response = await page.goto(path);
            expect(response?.status()).toBe(200);
            await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
            );
            expect(overflow, "no sideways scrolling").toBe(false);
            // Let React hydrate first: hiding the caret for the screenshot edits inputs.
            await page.waitForLoadState("networkidle");
            const tall = await page.evaluate(() => document.documentElement.scrollHeight > 12_000);
            await page.screenshot({
              path: `${SHOTS}/office-${role}-${name}-${vp.name}-${scheme}.png`,
              fullPage: !tall, // Chromium can't capture very tall pages in one image
              animations: "disabled",
            });
            const axe = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze();
            expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
            expect(errors).toEqual([]);
          });
        }
      }
    }
  });
}

test.describe("moving students between hostels", () => {
  test.use({ storageState: ADMIN_STATE });

  test("the office moves a student, but not while they're out", async ({ page }) => {
    // Students pick their hostel once; after that the office moves them.
    await page.goto("/admin/people?q=sara");
    const sara = page.getByRole("listitem").filter({ hasText: "Sara Khan" });
    await sara.getByRole("combobox", { name: "Hostel: Hostel 3" }).selectOption("Hostel 5");
    await sara.getByRole("button", { name: "Move" }).click();
    await expect(sara).toContainText("Moved.");
    await expect(sara.getByRole("combobox", { name: "Hostel: Hostel 5" })).toBeVisible();
    // Back where she was, so the screenshots above stay the same on the next run.
    await sara.getByRole("combobox", { name: "Hostel: Hostel 5" }).selectOption("Hostel 3");
    await sara.getByRole("button", { name: "Move" }).click();
    await expect(sara.getByRole("combobox", { name: "Hostel: Hostel 3" })).toBeVisible();

    // Neha is out: her hostel's rules apply to this outing, so she can't be moved yet.
    await page.goto("/admin/people?q=neha");
    const neha = page.getByRole("listitem").filter({ hasText: "Neha Rawat" });
    await neha.getByRole("combobox", { name: "Hostel: Hostel 5" }).selectOption("Hostel 3");
    await neha.getByRole("button", { name: "Move" }).click();
    await expect(neha).toContainText("They're out or have an outing request for today.");
  });
});
