import { expect, test, type Browser, type Locator, type Page } from "./fixtures";

import { ADMIN_STATE, DEVELOPER_STATE } from "../playwright.config";
import { watchForErrors } from "./helpers";

/**
 * A developer's read-only "View as" a ROLE (contract: .claude/tasks/view-as-contract.md): a
 * menu with Developer and the four roles shows that role's screens with the developer's own
 * data. The developer (e2e-dev@) is in the standard seed of backend/scripts/e2e_server.py, so
 * this runs without --demo (as CI does).
 */

const banner = (page: Page) => page.getByRole("region", { name: "Viewing as" });
const officeNav = (page: Page) => page.getByRole("navigation", { name: "Hostel office" });
const viewAsButton = (scope: Locator | Page) => scope.getByRole("button", { name: "View as" });

/** The developer's own session (signed in once, in auth.setup.ts), in a fresh context. */
async function asDeveloper(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: DEVELOPER_STATE });
  return context.newPage();
}

/** From the office nav (the developer as themselves): open the menu and choose `role`. */
async function viewAs(page: Page, role: string): Promise<void> {
  await page.goto("/admin");
  await viewAsButton(officeNav(page)).click();
  await page.getByRole("menuitemradio", { name: role, exact: true }).click();
}

test("a developer views as a student: Today's screens, own (empty) data, read-only", async ({
  browser,
}) => {
  const page = await asDeveloper(browser);
  const errors = watchForErrors(page);

  await page.goto("/admin");
  const button = viewAsButton(officeNav(page));
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: "View as" });
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Developer",
    "Admin",
    "Head warden",
    "Warden",
    "Student",
  ]);
  await expect(menu.getByRole("menuitemradio", { name: "Developer" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(menu.getByRole("menuitemradio", { name: "Student" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await menu.getByRole("menuitemradio", { name: "Student" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(banner(page)).toContainText("Viewing as Student. Read-only.");
  await expect(page.getByRole("heading", { name: "Heading out?" })).toBeVisible();
  // The tour never runs while viewing.
  await expect(page.locator("[data-tour-status]")).toHaveAttribute("data-tour-status", "off");

  // The developer's own data: no outings, so the student screens show their empty states.
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "No outings yet" })).toBeVisible();
  await expect(banner(page)).toBeVisible();

  // The banner's menu has Student checked now.
  await viewAsButton(banner(page)).click();
  await expect(page.getByRole("menuitemradio", { name: "Student" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  // A change is refused, and the form says why.
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("button", { name: "Take the tour again" })).toHaveCount(0);
  await page.getByLabel("Your phone number").fill("9876543210");
  await page.getByLabel("Emergency contact").fill("Asha");
  await page.getByLabel("Relation").fill("Mother");
  await page.getByLabel("Their phone", { exact: true }).fill("9876543211");
  await page.getByRole("button", { name: "Save contacts" }).click();
  await expect(page.getByText(/you're viewing as another role, which is read-only/)).toBeVisible();

  // A student can't open the office, so neither can the developer while viewing as one.
  expect((await page.goto("/admin"))?.status()).toBe(404);

  // Stop: back to Developer, in the office, with the nav's menu again.
  await page.goto("/home");
  await banner(page).getByRole("button", { name: "Stop" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(banner(page)).toHaveCount(0);
  await expect(viewAsButton(officeNav(page))).toBeVisible();
  await expect(officeNav(page).getByRole("link", { name: "Gates" })).toBeVisible();

  // Nothing failed but the 404 asked for above (and the browser's console line for it).
  expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
  await page.context().close();
});

test("viewing as a warden hides the admin-only office pages", async ({ browser }) => {
  const page = await asDeveloper(browser);
  await viewAs(page, "Warden");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(banner(page)).toContainText("Viewing as Warden. Read-only.");

  const nav = officeNav(page);
  await expect(nav.getByRole("link", { name: "Register" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "My hostel" })).toBeVisible();
  for (const name of ["Gates", "Rules", "Settings"]) {
    await expect(nav.getByRole("link", { name })).toHaveCount(0);
  }
  // While viewing, the menu is in the banner only, not the warden's nav.
  await expect(viewAsButton(nav)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Take the tour again" })).toHaveCount(0);
  for (const path of ["/admin/gates", "/admin/settings", "/admin/rules"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }

  // Choosing Developer in the banner's menu is the same as Stop.
  await page.goto("/admin");
  await viewAsButton(banner(page)).click();
  await page.getByRole("menuitemradio", { name: "Developer" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(banner(page)).toHaveCount(0);
  await expect(officeNav(page).getByRole("link", { name: "Settings" })).toBeVisible();
  await page.context().close();
});

test("the View as menu works from the keyboard", async ({ browser }) => {
  const page = await asDeveloper(browser);
  await page.goto("/admin");
  const button = viewAsButton(officeNav(page));
  const item = (name: string) => page.getByRole("menuitemradio", { name, exact: true });

  // Enter opens on the checked item; arrows wrap; Home/End jump; Escape returns to the button.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(item("Developer")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Admin")).toBeFocused();
  await page.keyboard.press("End");
  await expect(item("Student")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Developer")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(item("Student")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(item("Developer")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // Space opens it too; Up opens on the last item.
  await page.keyboard.press("Space");
  await expect(item("Developer")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowUp");
  await expect(item("Student")).toBeFocused();
  await page.keyboard.press("Escape");

  // Down, Down, Down, Enter: Head warden.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(item("Head warden")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(banner(page)).toContainText("Viewing as Head warden. Read-only.");
  await expect(officeNav(page).getByRole("link", { name: "Rules" })).toBeVisible();
  await expect(officeNav(page).getByRole("link", { name: "Settings" })).toHaveCount(0);

  await banner(page).getByRole("button", { name: "Stop" }).press("Enter");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(banner(page)).toHaveCount(0);
  await page.context().close();
});

test("the menu fits a phone screen without sideways scrolling", async ({ browser }) => {
  const page = await asDeveloper(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await viewAsButton(officeNav(page)).click();
  const menu = page.getByRole("menu", { name: "View as" });
  await expect(menu).toBeVisible();
  // Measure the resting menu, not a frame of its scale(0.98) entrance.
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  for (const target of await menu.getByRole("menuitemradio").all()) {
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.context().close();
});

test.describe("not a developer", () => {
  test.use({ storageState: ADMIN_STATE });

  test("an admin never sees the View as menu", async ({ page }) => {
    await page.goto("/admin");
    await expect(officeNav(page).getByRole("link", { name: "Register" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View as" })).toHaveCount(0);
    await expect(banner(page)).toHaveCount(0);
  });

  test("a View as cookie the API refuses is cleared, and the page works", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "lb_view_as_role",
        value: "student",
        url: "http://localhost:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home$/);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByText("Signed in as")).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "lb_view_as_role")).toBeUndefined();
  });
});
