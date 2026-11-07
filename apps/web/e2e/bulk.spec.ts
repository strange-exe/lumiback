import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN_STATE, DEVELOPER_STATE } from "../playwright.config";
import { ADMIN, API, designMatrix, watchForErrors } from "./helpers";

// Acting on several people at once from People (features/admin/bulk.ts): tick rows, then move
// them, send their set-up links again, or turn them off. Each person goes through the same API
// call as their own row's button, and the results come back per person. Who may do what is
// covered by the backend's tests; here: the page, end to end.
//
// The people are added (and removed again) by this file, through the API: three students in
// Hostel 3 who haven't set up, and a second hostel to move them to.

const PREFIX = "Bulkrow";
const PEOPLE = ["Bulkrow Anika", "Bulkrow Bhavesh", "Bulkrow Chitra"];
const OTHER_HOSTEL = "Hostel 9";

interface Setup {
  token: string;
  hostelId: string;
  ids: string[];
}

/** One API sign-in for the whole file (sign-ins are rate-limited per IP; the token lasts 15 min). */
let token: Promise<string> | null = null;

function adminToken(request: APIRequestContext): Promise<string> {
  token ??= request
    .post(`${API}/auth/login`, { data: { email: ADMIN.email, password: ADMIN.password } })
    .then(async (r) => {
      expect(r.status()).toBe(200);
      return ((await r.json()) as { access_token: string }).access_token;
    });
  return token;
}

async function api<T>(
  request: APIRequestContext,
  token: string,
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const r = await request.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(r.ok(), `${method} ${path}: ${await r.text()}`).toBe(true);
  return (r.status() === 204 ? null : await r.json()) as T;
}

async function setUp(request: APIRequestContext): Promise<Setup> {
  const token = await adminToken(request);
  // A test that timed out never reached its own tearDown: start from a clean slate.
  const leftover = await api<{ id: string }[]>(
    request,
    token,
    "GET",
    `/admin/students?q=${PREFIX.toLowerCase()}`,
  );
  const before = await api<{ id: string; name: string }[]>(request, token, "GET", "/admin/hostels");
  await tearDown(request, {
    token,
    hostelId: before.find((h) => h.name === OTHER_HOSTEL)?.id ?? "",
    ids: leftover.map((p) => p.id),
  });
  const hostels = await api<{ id: string; name: string }[]>(
    request,
    token,
    "GET",
    "/admin/hostels",
  );
  const hostel3 = hostels.find((h) => h.name === "Hostel 3")!;
  const ruleSets = await api<{ id: string }[]>(request, token, "GET", "/admin/rule-sets");
  const created = await api<{ id: string; name: string }[]>(
    request,
    token,
    "POST",
    "/admin/hostels",
    {
      name: OTHER_HOSTEL,
      rule_set_id: ruleSets[0]!.id,
    },
  );
  const hostelId = created.find((h) => h.name === OTHER_HOSTEL)!.id;
  for (const [i, name] of PEOPLE.entries()) {
    await api(request, token, "POST", "/admin/people", {
      name,
      role: "student",
      student_id: `2401990${i}`,
      email: `bulkrow${i}@geu.ac.in`,
      hostel_id: hostel3.id,
    });
  }
  const listed = await api<{ id: string; name: string }[]>(
    request,
    token,
    "GET",
    `/admin/students?q=${PREFIX.toLowerCase()}`,
  );
  return { token, hostelId, ids: listed.map((p) => p.id) };
}

/** Removes this file's people and hostel, whatever a failed test left behind. */
async function tearDown(request: APIRequestContext, setup: Setup): Promise<void> {
  for (const id of setup.ids) {
    await request.delete(`${API}/admin/users/${id}/invite`, {
      headers: { Authorization: `Bearer ${setup.token}` },
    });
  }
  if (!setup.hostelId) return;
  await request.delete(`${API}/admin/hostels/${setup.hostelId}`, {
    headers: { Authorization: `Bearer ${setup.token}` },
  });
}

/** A person's row in the People list (not their line in the results above it). */
const row = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "People", exact: true })
    .locator(":scope > li")
    .filter({ hasText: name });
/** Opens People for this file's people, once the page runs its scripts (ticks count then). */
async function openPeople(page: Page): Promise<void> {
  await page.goto(`/admin/people?q=${PREFIX.toLowerCase()}`);
  await expect(page.getByRole("checkbox", { name: /^Select all shown/ })).toBeVisible();
}
const tick = (page: Page, name: string) => page.getByRole("checkbox", { name: `Tick ${name}` });
const bar = (page: Page) => page.locator("form#people-bulk");
/** The last submit's summary and per-person results (a polite live region). */
const results = (page: Page) => page.getByRole("status", { name: "What happened" });
/** A refusal of the whole submit (the bulk form's error, role=alert). */
const problem = (page: Page) => page.locator("#people-bulk-error");

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("tick people, then move them, send set-up links, and turn them off", async ({
    page,
    request,
  }) => {
    const setup = await setUp(request);
    const errors = watchForErrors(page);
    try {
      await openPeople(page);
      for (const name of PEOPLE) await expect(row(page, name)).toBeVisible();
      // Nothing ticked: no bar.
      await expect(bar(page)).toBeHidden();

      await tick(page, PEOPLE[0]!).check();
      await expect(bar(page)).toBeVisible();
      await expect(bar(page).getByRole("heading", { name: "1 ticked" })).toBeVisible();
      await page.getByRole("checkbox", { name: "Select all shown (3)" }).check();
      await expect(bar(page).getByRole("heading", { name: "3 ticked" })).toBeVisible();
      for (const name of PEOPLE) await expect(tick(page, name)).toBeChecked();
      await designMatrix(page, "people-bulk-bar");

      // Move all three: one result per person, in words.
      await bar(page).getByLabel("Hostel to move them to").selectOption({ label: OTHER_HOSTEL });
      await bar(page).getByRole("button", { name: "Move" }).click();
      await expect(results(page)).toContainText("3 moved.");
      for (const name of PEOPLE) {
        await expect(results(page)).toContainText(`${name}Done: Moved to ${OTHER_HOSTEL}.`);
      }
      // The ticks are cleared and the bar goes.
      await expect(bar(page)).toBeHidden();
      for (const name of PEOPLE) await expect(row(page, name)).toContainText(OTHER_HOSTEL);

      // Set-up links again, for the two ticked.
      await tick(page, PEOPLE[0]!).check();
      await tick(page, PEOPLE[1]!).check();
      await bar(page).getByRole("button", { name: "Send set-up link again" }).click();
      await expect(results(page)).toContainText("2 links sent.");
      await expect(results(page)).toContainText("Set-up link sent to bulkrow0@geu.ac.in.");

      // Turn off asks first, naming how many.
      await tick(page, PEOPLE[1]!).check();
      await tick(page, PEOPLE[2]!).check();
      await bar(page).getByRole("button", { name: "Turn off" }).click();
      const dialog = page.getByRole("dialog", { name: "Turn off 2 accounts?" });
      await expect(dialog).toBeVisible();
      await designMatrix(page, "people-bulk-turn-off");
      await dialog.getByRole("button", { name: "Keep them on" }).click();
      await expect(dialog).toBeHidden();
      await bar(page).getByRole("button", { name: "Turn off" }).click();
      await dialog.getByRole("button", { name: "Turn off 2" }).click();
      await expect(results(page)).toContainText("2 turned off.");
      await expect(row(page, PEOPLE[1]!).getByText("Turned off", { exact: true })).toBeVisible();
      await expect(row(page, PEOPLE[2]!).getByText("Turned off", { exact: true })).toBeVisible();
      await expect(row(page, PEOPLE[0]!).getByText("Turned off", { exact: true })).toHaveCount(0);
      await designMatrix(page, "people-bulk-results");
      expect(errors).toEqual([]);
    } finally {
      await tearDown(request, setup);
    }
  });

  test("the server checks every submit: ids, the limit, and the confirmed count", async ({
    page,
    request,
  }) => {
    const setup = await setUp(request);
    try {
      await openPeople(page);
      await tick(page, PEOPLE[0]!).check();
      // A forged id: nothing is sent, the whole submit is refused.
      await page.evaluate(() => {
        const box = document.createElement("input");
        Object.assign(box, { type: "hidden", name: "ids", value: "../gates" });
        box.setAttribute("form", "people-bulk");
        document.body.append(box);
      });
      await bar(page).getByRole("button", { name: "Send set-up link again" }).click();
      await expect(problem(page)).toHaveText(
        "Someone in the list couldn't be found. Reload the page and try again.",
      );

      // More than 100 ids (valid-looking ones): refused before any call.
      await openPeople(page);
      await tick(page, PEOPLE[0]!).check();
      await page.evaluate(() => {
        for (let i = 0; i < 101; i++) {
          const box = document.createElement("input");
          box.type = "hidden";
          box.name = "ids";
          box.value = `5f0c2a1e-0000-4000-8000-${String(i).padStart(12, "0")}`;
          box.setAttribute("form", "people-bulk");
          document.body.append(box);
        }
      });
      await bar(page).getByRole("button", { name: "Send set-up link again" }).click();
      await expect(problem(page)).toHaveText(
        "Choose at most 100 people at a time. Nothing was changed.",
      );

      // Turning off with a count that doesn't match who's ticked is refused.
      await openPeople(page);
      await tick(page, PEOPLE[0]!).check();
      await bar(page).getByRole("button", { name: "Turn off" }).click();
      await page.evaluate(() => {
        const box = document.createElement("input");
        Object.assign(box, {
          type: "hidden",
          name: "ids",
          value: "5f0c2a1e-0000-4000-8000-000000000999",
        });
        box.setAttribute("form", "people-bulk");
        document.body.append(box);
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^Turn off/ })
        .click();
      await expect(problem(page)).toContainText("The ticked people changed.");
      await openPeople(page);
      for (const name of PEOPLE) {
        await expect(row(page, name).getByText("Turned off", { exact: true })).toHaveCount(0);
      }
    } finally {
      await tearDown(request, setup);
    }
  });
});
// No test without JavaScript: the office pages stream behind loading.tsx, so without scripts
// People (like every office page) stays on "Loading…" before and after this change.

test("viewing as an admin, the API refuses and the page says so per person", async ({
  browser,
  request,
}) => {
  const setup = await setUp(request);
  const context = await browser.newContext({ storageState: DEVELOPER_STATE });
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await page
      .getByRole("navigation", { name: "Hostel office" })
      .getByRole("button", { name: "View as" })
      .click();
    await page.getByRole("menuitemradio", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("region", { name: "Viewing as" })).toBeVisible();
    await openPeople(page);
    await page.getByRole("checkbox", { name: "Select all shown (3)" }).check();
    await bar(page).getByRole("button", { name: "Turn off" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Turn off 3" }).click();
    await expect(results(page)).toContainText("0 turned off, 3 not.");
    await expect(results(page)).toContainText(
      "Nothing was changed: you're viewing as another role, which is read-only.",
    );
    await expect(results(page)).toContainText("Not tried: Nothing was changed");
    await openPeople(page);
    for (const name of PEOPLE) {
      await expect(row(page, name).getByText("Turned off", { exact: true })).toHaveCount(0);
    }
  } finally {
    await context.close();
    await tearDown(request, setup);
  }
});
