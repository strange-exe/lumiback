import { readFileSync } from "node:fs";

import { expect, test, type Browser, type Page } from "./fixtures";

import { ADMIN_STATE, HEAD_WARDEN_STATE, WARDEN_STATE } from "../playwright.config";
import { API, checkOut, designMatrix, ensureIn, watchForErrors } from "./helpers";

/**
 * The hostel board (.claude/tasks/hostel-board-spec.md, Web). The standard seed
 * (backend/scripts/e2e_server.py) has one hostel, Hostel 3, with its warden (e2e-warden@); the
 * seeded student (e2e@) has no hostel, so they read only "All hostels" posts. The tests run in
 * order: the student's board is empty until the head warden posts to all hostels.
 */

test.describe.configure({ mode: "serial" });

const NL = String.fromCodePoint(0x0a);
const XSS = "<img src=x onerror=alert(1)>";
const WARDEN_TITLE = "Hostel 3 laundry closed Monday";
const ALL_TITLE = "Water off on Saturday morning";

/** An access token from a session the setup project saved. */
function tokenFrom(file: string): string {
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error(`${file} has no access token`);
  return cookie.value;
}

async function open(browser: Browser, state: string, path: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: state })).newPage();
  await page.goto(path);
  return page;
}

/** Fill the board form and post it through the confirm dialog. */
async function post(page: Page, title: string, body: string): Promise<void> {
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Post", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Review and post" }).click();
  const dialog = page.getByRole("dialog", { name: "Post to the board?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dialog).toBeHidden();
  // "Posted. For 2 students, ..." or, for a hostel with nobody in it yet, "Posted. No students ...".
  await expect(page.getByText(/^Posted\. /)).toBeVisible();
}

const boardRow = (page: Page, title: string) =>
  page
    .getByRole("region", { name: "On the board for your hostels" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title }) });

test("a warden posts to their own hostel, and can't post anywhere else", async ({
  browser,
  page,
  request,
}) => {
  const warden = await open(browser, WARDEN_STATE, "/admin/board");
  const errors = watchForErrors(warden);
  await expect(warden.getByRole("heading", { name: "Hostel board", level: 1 })).toBeVisible();
  // One hostel: no picker, and never "All hostels".
  await expect(warden.getByText("the students in Hostel 3")).toBeVisible();
  await expect(
    warden.getByRole("checkbox", { name: "All hostels, and students without a hostel" }),
  ).toHaveCount(0);
  await post(warden, WARDEN_TITLE, `Machines are serviced all day.${NL}Use B block's.`);
  const row = boardRow(warden, WARDEN_TITLE);
  await expect(row).toHaveAttribute("data-status", "Active");
  await expect(row.getByText("for Hostel 3")).toBeVisible();
  expect(errors).toEqual([]);
  await warden.context().close();

  // The API refuses another hostel (404, as for an unknown one) and all hostels (403).
  const admin = { Authorization: `Bearer ${tokenFrom(ADMIN_STATE)}` };
  const wardenAuth = { Authorization: `Bearer ${tokenFrom(WARDEN_STATE)}` };
  const rules = (await (
    await request.get(`${API}/admin/rule-sets`, { headers: admin })
  ).json()) as {
    id: string;
  }[];
  const created = await request.post(`${API}/admin/hostels`, {
    headers: admin,
    data: { name: "Board Test Hostel", rule_set_id: rules[0]!.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  const other = ((await created.json()) as { id: string; name: string }[]).find(
    (h) => h.name === "Board Test Hostel",
  )!;
  try {
    const body = { category: "general", title: "Not yours", body: "Not yours." };
    const elsewhere = await request.post(`${API}/admin/board`, {
      headers: wardenAuth,
      data: { ...body, hostel_ids: [other.id] },
    });
    expect(elsewhere.status()).toBe(404);
    const everywhere = await request.post(`${API}/admin/board`, {
      headers: wardenAuth,
      data: { ...body, all_hostels: true },
    });
    expect(everywhere.status()).toBe(403);
  } finally {
    await request.delete(`${API}/admin/hostels/${other.id}`, { headers: admin });
  }

  // The seeded student has no hostel: a Hostel 3 post isn't theirs, so their board is empty.
  await page.goto("/board");
  await expect(page.getByText("Nothing on your hostel's board right now.")).toBeVisible();
  await expect(page.getByRole("heading", { name: WARDEN_TITLE })).toHaveCount(0);
});

test("a head warden posts to all hostels; the student sees it New once, as plain text", async ({
  browser,
  page,
}) => {
  const head = await open(browser, HEAD_WARDEN_STATE, "/admin/board");
  await head.getByRole("checkbox", { name: "All hostels, and students without a hostel" }).check();
  await expect(head.locator("p[aria-live][data-state]")).toHaveAttribute("data-state", "ready");
  await post(head, ALL_TITLE, `${XSS}${NL}Fill a bucket the night before.`);
  await expect(boardRow(head, ALL_TITLE).getByText("General, for All hostels")).toBeVisible();
  await designMatrix(head, "board-staff");
  await head.context().close();

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const errors = watchForErrors(page);
  await ensureIn(page);
  const section = page.getByRole("region", { name: "Hostel board" });
  // "New" is text inside the post's heading, so it is part of its name.
  await expect(section.getByRole("heading", { name: `${ALL_TITLE} New` })).toBeVisible();
  await expect(section.getByText("From Campus office")).toBeVisible();
  // The body is text: the tag shows as typed, and nothing runs.
  await expect(section.getByText(XSS, { exact: false })).toBeVisible();
  await expect(page.locator("main img[src='x']")).toHaveCount(0);
  // One seen call for the posts this view showed; "New" goes from the next view.
  await expect(page.locator("[data-board-seen]")).toHaveAttribute("data-board-seen", "done");
  // Home with the board and its "New" label, at both widths in both schemes.
  await designMatrix(page, "board-home");
  await page.reload();
  await expect(section.getByRole("heading", { name: ALL_TITLE })).toBeVisible();
  await expect(section.getByText("New", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-board-seen]")).toHaveAttribute("data-board-seen", "skipped");

  // The full board says the same, and is checked at both widths in both schemes.
  await page.goto("/board");
  await expect(page.getByRole("heading", { name: ALL_TITLE, level: 2 })).toBeVisible();
  await expect(page.locator("main img[src='x']")).toHaveCount(0);
  await designMatrix(page, "board-student");

  // While out, the board is still on home, below the trip.
  await checkOut(page, "Board Walk");
  await expect(page.getByRole("region", { name: "Hostel board" })).toBeVisible();
  await ensureIn(page);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("taking a post down hides it from students", async ({ browser, page }) => {
  const head = await open(browser, HEAD_WARDEN_STATE, "/admin/board");
  await head.getByRole("button", { name: `Withdraw: ${ALL_TITLE}` }).click();
  await head.getByRole("dialog").getByRole("button", { name: "Take it down" }).click();
  await expect(boardRow(head, ALL_TITLE)).toHaveAttribute("data-status", "Withdrawn");
  await head.context().close();

  await page.goto("/board");
  await expect(page.getByText("Nothing on your hostel's board right now.")).toBeVisible();
  await page.goto("/home");
  await expect(page.getByRole("region", { name: "Hostel board" })).toHaveCount(0);
});

test("the rules page announces a change on the board, with the rule set's hostels", async ({
  browser,
}) => {
  const admin = await open(browser, ADMIN_STATE, "/admin/rules");
  const errors = watchForErrors(admin);
  await admin
    .getByRole("link", { name: /^Announce this change/ })
    .first()
    .click();
  await expect(admin).toHaveURL(/\/admin\/board\?draft=[0-9a-f-]{36}$/);
  await expect(admin.getByRole("checkbox", { name: "Hostel 3" })).toBeChecked();
  await expect(admin.getByLabel("Title")).toHaveValue("Outing timings");
  await expect(admin.getByLabel("About")).toHaveValue("timings");
  await expect(admin.getByLabel("Post", { exact: true })).toHaveValue(/^Outing timings from /);
  expect(errors).toEqual([]);
  await admin.context().close();
});

test("what is typed while the outing rules are written out is kept, and asked about", async ({
  browser,
}) => {
  const head = await open(browser, HEAD_WARDEN_STATE, "/admin/board");
  const errors = watchForErrors(head);
  await head.getByRole("checkbox", { name: "Hostel 3" }).check();
  await expect(head.locator("p[aria-live][data-state]")).toHaveAttribute("data-state", "ready");
  // Hold the draft's server action, as a cold start would, while the warden keeps typing.
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await head.route("**/admin/board**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) await held;
    await route.continue();
  });
  await head.getByRole("button", { name: "Use the outing rules" }).click();
  await expect(head.getByRole("button", { name: /^Writing the rules out/ })).toBeVisible();
  await head.getByLabel("Post", { exact: true }).fill("Typed while the draft was written.");
  await head.getByLabel("Shows for").selectOption("3");
  release();
  // The empty title is filled; the typed post is not replaced without asking.
  await expect(head.getByRole("dialog", { name: "Replace what you wrote?" })).toBeVisible();
  await expect(head.getByLabel("Title")).toHaveValue("Outing timings");
  await expect(head.getByLabel("Post", { exact: true })).toHaveValue(
    "Typed while the draft was written.",
  );
  await expect(head.getByLabel("Shows for")).toHaveValue("3");
  await head.getByRole("button", { name: "Keep what I wrote" }).click();
  await expect(head.getByLabel("Post", { exact: true })).toHaveValue(
    "Typed while the draft was written.",
  );
  expect(errors).toEqual([]);
  await head.context().close();
});

test("the old notice is now 'Message students who are out'", async ({ browser }) => {
  const admin = await open(browser, ADMIN_STATE, "/admin");
  await expect(admin.getByRole("heading", { name: "Message students who are out" })).toBeVisible();
  await expect(admin.getByText("post to the hostel board", { exact: false })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Send message" })).toBeVisible();
  await admin.context().close();
});
