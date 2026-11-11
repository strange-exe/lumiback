import { readFileSync } from "node:fs";

import { expect, test, type Browser, type Page } from "./fixtures";

import { ADMIN_STATE, DEVELOPER_STATE, STUDENT_STATE, WARDEN_STATE } from "../playwright.config";
import { API, checkOut, designMatrix, ensureIn, watchForErrors } from "./helpers";

// Wave 4 on the website: the office's Reports page (counts per hostel, never names) and the
// developers' Errors page (scrubbed reports from the website and the app). The numbers, the
// scoping and the scrubbing are covered by the backend's tests; here: the pages. Lean on purpose.

/** An access token from a session the setup project saved. */
function tokenFrom(file: string): string {
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error(`${file} has no access token`);
  return cookie.value;
}

const officeNav = (page: Page) => page.getByRole("navigation", { name: "Hostel office" });

async function open(browser: Browser, state: string): Promise<Page> {
  const context = await browser.newContext({ storageState: state, acceptDownloads: true });
  return context.newPage();
}

test("the office reads a report for the last 30 days and downloads it", async ({ browser }) => {
  // One finished trip today, so the report has something in it whatever ran before.
  const student = await open(browser, STUDENT_STATE);
  try {
    await checkOut(student, "Rajpur Road");
    await ensureIn(student);
  } finally {
    await student.context().close();
  }

  const page = await open(browser, ADMIN_STATE);
  const errors = watchForErrors(page);
  try {
    await page.goto("/admin");
    await officeNav(page).getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/admin\/reports$/);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

    const table = page.getByRole("region", { name: "By hostel" });
    await expect(table.getByRole("rowheader", { name: "Hostel 3" })).toBeVisible();
    const total = table.getByRole("row", { name: /^All hostels/ });
    await expect(total).toBeVisible();
    // The bars repeat numbers written out as text.
    await expect(page.getByRole("region", { name: "Week by week" })).toContainText(
      /\d+ trips?, \d+ late/,
    );
    // Counts only: the seeded student's name appears nowhere.
    await expect(page.locator("main")).not.toContainText("Riya");

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^report-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const text = readFileSync(await file.path(), "utf8");
    expect(text.codePointAt(0)).toBe(0xfeff);
    expect(text.split("\n")[0]).toContain("Hostel,Outings,Left through a gate");
    expect(text).toContain("All hostels");
    expect(text).not.toContain("Riya");

    await designMatrix(page, "reports");
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
});

test("a backwards range says so next to the dates, and asks for nothing", async ({ browser }) => {
  const page = await open(browser, ADMIN_STATE);
  const errors = watchForErrors(page);
  try {
    await page.goto("/admin/reports?from=2026-03-01&to=2026-02-01");
    const form = page.getByRole("form", { name: "Choose the dates" });
    await expect(form.getByRole("alert")).toHaveText(/end date is before the start date/);
    await expect(form.getByLabel("From")).toHaveValue("2026-03-01"); // kept, to fix
    await expect(page.getByRole("region", { name: "By hostel" })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }
});

/** The first column of each line of a report's CSV, as the given account downloads it. */
async function csvHostels(page: Page, from: string, to: string): Promise<string[]> {
  const r = await page.request.get(`/admin/reports/export?from=${from}&to=${to}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("text/csv");
  const text = await r.text();
  return (text.codePointAt(0) === 0xfeff ? text.slice(1) : text) // the BOM for Excel
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(",", 1)[0]!);
}

test("a warden's report lists only their own hostel", async ({ browser, request }) => {
  // A second hostel for this test only (the plain seed has Hostel 3 alone): the admin's report
  // lists it, the warden of Hostel 3's must not. A report lists every hostel in scope even with
  // nothing in it, so the rows are known whatever earlier specs did.
  // The admin's saved session, not a fresh password login: by this point in a full run the
  // login rate limit can answer 429 (it did on CI).
  const headers = { Authorization: `Bearer ${tokenFrom(ADMIN_STATE)}` };
  const ruleSets = (await (await request.get(`${API}/admin/rule-sets`, { headers })).json()) as {
    id: string;
  }[];
  const other = `W4 Other ${String(Date.now()).slice(-6)}`;
  const created = await request.post(`${API}/admin/hostels`, {
    headers,
    data: { name: other, rule_set_id: ruleSets[0]!.id },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const otherId = ((await created.json()) as { id: string; name: string }[]).find(
    (h) => h.name === other,
  )!.id;

  const to = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10); // IST today
  const from = new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
  const admin = await open(browser, ADMIN_STATE);
  const page = await open(browser, WARDEN_STATE);
  try {
    const all = await csvHostels(admin, from, to);
    expect(all).toContain(other);
    expect(all).toContain("Hostel 3");
    expect(all.at(-1)).toBe("All hostels");

    // Exactly: the header, Hostel 3 and their total. Not the other hostel, not "No hostel".
    expect(await csvHostels(page, from, to)).toEqual(["Hostel", "Hostel 3", "Your hostels"]);

    await page.goto(`/admin/reports?from=${from}&to=${to}`);
    // The page itself: the table when Hostel 3 has something in range, else the empty state;
    // never another hostel's (or "No hostel") counts.
    const shown = page.locator("[data-state=empty], [data-state=ready]");
    await expect(shown).toBeVisible();
    if ((await shown.getAttribute("data-state")) === "ready") {
      const table = page.getByRole("region", { name: "By hostel" });
      await expect(table.getByRole("rowheader")).toHaveText(["Hostel 3", "Your hostels"]);
    } else {
      await expect(shown).toContainText("Nothing to count between");
    }
  } finally {
    await admin.context().close();
    await page.context().close();
    await request.delete(`${API}/admin/hostels/${otherId}`, { headers });
  }
});

test("a developer sees errors scrubbed and grouped; nobody else does", async ({ browser }) => {
  const page = await open(browser, DEVELOPER_STATE);
  const errors = watchForErrors(page);
  // Letters only: the API would scrub a long number (a timestamp) as [number].
  const tag = Array.from(
    { length: 8 },
    () => "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)],
  );
  const marker = `W4 probe ${tag.join("")}`;
  try {
    await page.goto("/admin");
    // What the website's reporter sends (lib/report-error.ts), twice: one group, seen twice.
    for (let i = 0; i < 2; i++) {
      const status = await page.evaluate(async (message) => {
        const response = await fetch("/api/errors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `${message} for riya@geu.ac.in on 9876543210`,
            stack: `Error: x\n    at Probe (http://localhost:3000/_next/static/chunks/app.js:1:2)`,
            route: "/admin?code=123",
            platform: "web",
          }),
        });
        return response.status;
      }, marker);
      expect(status).toBe(204);
    }

    await officeNav(page).getByRole("link", { name: "Errors" }).click();
    await expect(page).toHaveURL(/\/admin\/errors$/);
    const group = page.getByRole("listitem").filter({ hasText: marker });
    await expect(group).toContainText(`${marker} for [email] on [phone]`);
    await expect(group).toContainText("2 times");
    await expect(group).toContainText("Website");
    await expect(group).toContainText("on /admin"); // never the query string
    await expect(page.locator("main")).not.toContainText("riya@geu.ac.in");
    await designMatrix(page, "errors");
    expect(errors).toEqual([]);
  } finally {
    await page.context().close();
  }

  const admin = await open(browser, ADMIN_STATE);
  try {
    await admin.goto("/admin");
    await expect(officeNav(admin).getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(officeNav(admin).getByRole("link", { name: "Errors" })).toHaveCount(0);
    expect((await admin.goto("/admin/errors"))?.status()).toBe(404);
  } finally {
    await admin.context().close();
  }
});
