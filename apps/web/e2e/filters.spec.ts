import { expect, test, type Page } from "@playwright/test";

import { ADMIN_STATE } from "../playwright.config";
import { ADMIN, designMatrix, signIn, watchForErrors } from "./helpers";

// Remembered filters (src/lib/filters.ts): the hostel office's lists open on the filter chosen
// last time; the address always wins; "All" resets; signing out forgets them.

const COOKIE = "lb_office_filters";

const current = (page: Page, nav: string) =>
  page.getByRole("navigation", { name: nav }).locator('[aria-current="page"]');

async function remembered(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === COOKIE)?.value;
}

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("the register, escalations and scans open on the last filter; All resets", async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    // Register: Late is remembered, the address wins, Everyone out resets.
    await page.goto("/admin");
    await expect(current(page, "Filter")).toHaveText("Everyone out");
    await page.getByRole("link", { name: "Late", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?state=overdue$/);
    await expect(current(page, "Filter")).toHaveText("Late");
    await page.goto("/admin");
    await expect(current(page, "Filter")).toHaveText("Late");
    await page.goto("/admin?state=all");
    await expect(current(page, "Filter")).toHaveText("Everyone out");
    await page.goto("/admin");
    await expect(current(page, "Filter")).toHaveText("Late"); // looking isn't choosing
    await designMatrix(page, "register-remembered");
    await page.getByRole("link", { name: "Everyone out" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin");
    await expect(current(page, "Filter")).toHaveText("Everyone out");

    // Escalations: All is remembered.
    await page.goto("/admin/escalations");
    await expect(current(page, "Filter")).toHaveText("Open");
    await page.getByRole("link", { name: "All", exact: true }).click();
    await expect(page).toHaveURL(/state=all/);
    await page.goto("/admin/escalations");
    await expect(current(page, "Filter")).toHaveText("All");
    await designMatrix(page, "escalations-remembered");
    await page.getByRole("link", { name: "Open", exact: true }).click();
    await page.goto("/admin/escalations");
    await expect(current(page, "Filter")).toHaveText("Open");

    // Scans: the filter form goes through the remembering route too.
    await page.goto("/admin/scans");
    await page.getByLabel("Result").selectOption("too_far");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/\/admin\/scans\?result=too_far$/);
    await page.goto("/admin/scans");
    await expect(page.getByLabel("Result")).toHaveValue("too_far");
    await expect(page.getByText("No scans match these filters.")).toBeVisible();
    await designMatrix(page, "scans-remembered");
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(/\/admin\/scans$/);
    await expect(page.getByLabel("Result")).toHaveValue("");

    // Requests remember nothing: a past day there would hide today's waiting requests.
    expect(await remembered(page)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("People opens on the last filter; a search is explicit", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/admin/people");
    await expect(current(page, "Show")).toHaveText("All students");
    await page.getByRole("link", { name: "Hasn't set up" }).click();
    await expect(page).toHaveURL(/\/admin\/people\?account=invited$/);
    await page.goto("/admin/people");
    await expect(current(page, "Show")).toHaveText("Hasn't set up");
    // A search in the address shows exactly that, with no remembered filter added.
    await page.goto("/admin/people?q=riya");
    await expect(current(page, "Show")).toHaveText("Search results");
    await expect(page.getByRole("listitem").filter({ hasText: "Riya Sharma" })).toBeVisible();
    await designMatrix(page, "people-search");
    await page.goto("/admin/people");
    await page.getByRole("link", { name: "All students" }).click();
    await page.goto("/admin/people");
    await expect(current(page, "Show")).toHaveText("All students");
    expect(await remembered(page)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("a forged or stale cookie is ignored, never sent on", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.context().addCookies([
      {
        name: COOKIE,
        value: encodeURIComponent(
          JSON.stringify({
            register: { state: "x' onmouseover='alert(1)" },
            people: { hostel: "../../admin/users", account: "off" },
            scans: { gate: "7a1b2c3d-0000-4000-8000-0000000000aa", result: "too_far" },
          }),
        ),
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/admin");
    await expect(current(page, "Filter")).toHaveText("Everyone out");
    // The valid part still applies; a gate that isn't one of the gates doesn't.
    await page.goto("/admin/people");
    await expect(current(page, "Show")).toHaveText("Turned off");
    await page.goto("/admin/scans");
    await expect(page.getByRole("combobox", { name: "Gate", exact: true })).toHaveValue("");
    await expect(page.getByLabel("Result")).toHaveValue("too_far");
    // Garbage: the page simply opens unfiltered.
    await page
      .context()
      .addCookies([{ name: COOKIE, value: "%7Bnot-json", domain: "localhost", path: "/" }]);
    await page.goto("/admin/people");
    await expect(current(page, "Show")).toHaveText("All students");
    expect(errors).toEqual([]);
  });

  test("a well-formed hostel that isn't one of theirs is never applied", async ({ page }) => {
    // Passes the UUID check, so only People's "one of my hostels" test stops it: applied,
    // the API would answer an empty list for a hostel that doesn't exist.
    const foreign = "7a1b2c3d-0000-4000-8000-0000000000bb";
    await page.context().addCookies([
      {
        name: COOKIE,
        value: encodeURIComponent(JSON.stringify({ people: { hostel: foreign } })),
        domain: "localhost",
        path: "/",
      },
    ]);
    for (const path of ["/admin/people", `/admin/people?hostel=${foreign}`]) {
      await page.goto(path);
      await expect(current(page, "Show"), path).toHaveText("All students");
      await expect(page.locator("input[data-bulk]").first(), path).toBeAttached();
    }
  });

  test("the filter route never redirects off the office", async ({ page }) => {
    for (const path of [
      "/admin/filter?view=https://evil.example",
      "/admin/filter?view=people&q=//evil.example",
      "/admin/filter",
    ]) {
      await page.goto(path);
      expect(new URL(page.url()).origin, path).toBe("http://localhost:3000");
      expect(new URL(page.url()).pathname, path).toMatch(/^\/admin(\/people)?$/);
    }
  });
});

test("signing out forgets the remembered filters", async ({ browser }) => {
  // Its own session: signing out here never touches the shared admin sign-in.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await signIn(page, ADMIN);
    await page.goto("/admin");
    await page.getByRole("link", { name: "Late", exact: true }).click();
    await expect(page).toHaveURL(/state=overdue/);
    expect(await remembered(page)).toBeDefined();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/(sign-in)?$/);
    expect(await remembered(page)).toBeUndefined();
  } finally {
    await context.close();
  }
});
