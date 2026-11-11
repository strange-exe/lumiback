import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page } from "./fixtures";

import { ADMIN_STATE, WARDEN_STATE } from "../playwright.config";
import { ADMIN, API, designMatrix, signIn, watchForErrors } from "./helpers";

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

  // Wave 5 (owner D1): role chips for admins and developers, with or without a search, with a
  // count; never remembered.
  test("People's role chips list one role, with a count, and aren't remembered", async ({
    page,
  }) => {
    const errors = watchForErrors(page);
    await page.goto("/admin/people");
    await expect(current(page, "Role")).toHaveText("All");
    await page
      .getByRole("navigation", { name: "Role" })
      .getByRole("link", { name: "Wardens", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/people\?role=warden$/);
    await expect(current(page, "Role")).toHaveText("Wardens");
    await expect(page.getByText(/^(\d+ (person|people) shown\.|No one shown\.)$/)).toBeVisible();
    const people = page.getByRole("list", { name: "People" }).getByRole("listitem");
    await expect(people.first()).toBeVisible();
    for (const row of await people.all()) await expect(row).toContainText("Warden");
    await designMatrix(page, "people-role-chips");
    // With a search too: still only that role.
    await page.goto("/admin/people?role=admin&q=ad");
    await expect(current(page, "Role")).toHaveText("Admins");
    await expect(people.first()).toBeVisible(); // the loop below can't pass on an empty list
    for (const row of await people.all()) await expect(row).toContainText("Admin");
    // Not remembered: a bare visit shows everyone again.
    await page.goto("/admin/people");
    await expect(current(page, "Role")).toHaveText("All");
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

  test("a well-formed hostel that isn't one of theirs is never applied", async ({
    page,
    request,
  }) => {
    // Passes the UUID check, so only People's "one of my hostels" test stops it: applied,
    // the API would answer an empty list for a hostel that doesn't exist. So someone must
    // live in a hostel: the plain seed has no one, so this test adds a student and removes them.
    const login = await request.post(`${API}/auth/login`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(login.status()).toBe(200);
    const { access_token } = (await login.json()) as { access_token: string };
    const headers = { Authorization: `Bearer ${access_token}` };
    const hostels = (await (await request.get(`${API}/admin/hostels`, { headers })).json()) as {
      id: string;
      name: string;
    }[];
    const added = await request.post(`${API}/admin/people`, {
      headers,
      data: {
        name: "Filterrow Ishaan",
        role: "student",
        student_id: "24019950",
        email: "filterrow0@geu.ac.in",
        hostel_id: hostels.find((h) => h.name === "Hostel 3")!.id,
      },
    });
    expect(added.ok(), await added.text()).toBe(true);
    const found = (await (
      await request.get(`${API}/admin/students?q=filterrow`, { headers })
    ).json()) as { id: string }[];
    const foreign = "7a1b2c3d-0000-4000-8000-0000000000bb";
    try {
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
    } finally {
      for (const { id } of found) {
        await request.delete(`${API}/admin/users/${id}/invite`, { headers });
      }
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

/** An access token from a session the setup project saved (no extra sign-in). */
function tokenFrom(file: string): string {
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error(`${file} has no access token`);
  return cookie.value;
}

// A student of the warden's own Hostel 3 (the plain e2e seed has none), added and removed by
// the test below through the API, so its row checks can't pass on an empty list.
const OWN_STUDENT = {
  name: "Filtersrow Kavya",
  student_id: "24019951",
  email: "filtersrow.kavya@geu.ac.in",
};

async function removeOwnStudent(request: APIRequestContext, auth: Record<string, string>) {
  const found = await request.get(`${API}/admin/students?q=filtersrow`, { headers: auth });
  for (const p of (await found.json()) as { id: string }[]) {
    await request.delete(`${API}/admin/users/${p.id}/invite`, { headers: auth });
  }
}

test("a warden gets no role chips, and a role in the address changes nothing", async ({
  browser,
  request,
}) => {
  const auth = { Authorization: `Bearer ${tokenFrom(ADMIN_STATE)}` };
  await removeOwnStudent(request, auth); // what a timed-out run left behind
  const hostels = (await (await request.get(`${API}/admin/hostels`, { headers: auth })).json()) as {
    id: string;
    name: string;
  }[];
  const added = await request.post(`${API}/admin/people`, {
    headers: auth,
    data: {
      ...OWN_STUDENT,
      role: "student",
      hostel_id: hostels.find((h) => h.name === "Hostel 3")!.id,
    },
  });
  expect(added.ok(), await added.text()).toBe(true);
  const context = await browser.newContext({ storageState: WARDEN_STATE });
  const page = await context.newPage();
  try {
    const errors = watchForErrors(page);
    await page.goto("/admin/people?role=admin");
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Role" })).toHaveCount(0);
    await expect(current(page, "Show")).toHaveText("All students");
    // Their own hostels' students only: no staff badge on any row.
    const people = page.getByRole("list", { name: "People" }).getByRole("listitem");
    await expect(people.filter({ hasText: OWN_STUDENT.name })).toBeVisible();
    for (const row of await people.all()) {
      await expect(row).not.toContainText(/\b(Admin|Developer|Head warden)\b/);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await removeOwnStudent(request, auth);
  }
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
