import { readFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { ADMIN_STATE } from "../playwright.config";
import { API, designMatrix, watchForErrors } from "./helpers";

// People shows every list 50 at a time (the office list, GET /admin/students, and an admin's
// search, GET /admin/users): a "More people" link opens the next page with the same search and
// filters, and a later page links back to the first (features/admin/people-roles.ts). This
// file adds 51 students who haven't set up (one CSV import; the e2e server only logs emails)
// and removes them again.

const PREFIX = "Pagerow";
const COUNT = 51;
// The admin's office list: the Students chip.
const LIST = `/admin/people?role=student&q=${PREFIX.toLowerCase()}`;
const UNKNOWN = "7a1b2c3d-0000-4000-8000-0000000000cc";

/** An access token from a session the setup project saved (no extra sign-in). */
function tokenFrom(file: string): string {
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies: { name: string; value: string }[];
  };
  const cookie = state.cookies.find((c) => c.name === "outing_at");
  if (!cookie) throw new Error(`${file} has no access token`);
  return cookie.value;
}

/** Removes this file's students, whatever a failed or timed-out run left behind. */
async function removeAll(request: APIRequestContext, headers: Record<string, string>) {
  const found = await request.get(`${API}/admin/students?q=${PREFIX.toLowerCase()}`, { headers });
  expect(found.ok(), await found.text()).toBe(true);
  for (const { id } of (await found.json()) as { id: string }[]) {
    await request.delete(`${API}/admin/users/${id}/invite`, { headers });
  }
}

const number = (i: number) => String(i).padStart(3, "0");
const rows = (page: Page) =>
  page.getByRole("list", { name: "People", exact: true }).locator(":scope > li");

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("People opens 50 at a time; More people shows the rest, then back to the first", async ({
    page,
    request,
  }) => {
    const headers = { Authorization: `Bearer ${tokenFrom(ADMIN_STATE)}` };
    await removeAll(request, headers);
    const lines = Array.from(
      { length: COUNT },
      (_, i) => `${i + 1},240198${number(i + 1)},${PREFIX} ${number(i + 1)},,,,Hostel 3`,
    );
    const csv = `index,student_id,name,phone number,parent's name,number,hostel\n${lines.join("\n")}\n`;
    const added = await request.post(`${API}/admin/students/import`, {
      headers,
      data: { csv, confirm: true },
    });
    expect(added.ok(), await added.text()).toBe(true);
    expect(((await added.json()) as { added: number }).added).toBe(COUNT);
    const errors = watchForErrors(page);
    try {
      await page.goto(LIST);
      await expect(rows(page)).toHaveCount(50);
      await expect(rows(page).first()).toContainText(`${PREFIX} 001`);
      await expect(rows(page).last()).toContainText(`${PREFIX} 050`);
      await expect(page.getByText("50 people shown.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to the first page" })).toHaveCount(0);
      await designMatrix(page, "people-first-page");

      // A plain link: reached and followed from the keyboard.
      const more = page.getByRole("link", { name: "More people" });
      await more.focus();
      await expect(more).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/[?&]after=/);
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText(`${PREFIX} 051`);
      await expect(page.getByText("1 person shown.")).toBeVisible();
      await expect(page.getByRole("link", { name: "More people" })).toHaveCount(0);
      // The same search and chip on the next page.
      await expect(page.getByRole("searchbox", { name: "Name, email or roll number" })).toHaveValue(
        PREFIX.toLowerCase(),
      );
      await expect(
        page.getByRole("navigation", { name: "Role" }).getByRole("link", { name: "Students" }),
      ).toHaveAttribute("aria-current", "page");
      await designMatrix(page, "people-later-page");

      await page.getByRole("link", { name: "Back to the first page" }).click();
      await expect(rows(page)).toHaveCount(50);
      expect(new URL(page.url()).searchParams.get("after")).toBeNull();
      expect(new URL(page.url()).searchParams.get("q")).toBe(PREFIX.toLowerCase());

      // A cursor that is no one's: an empty page, with the way back.
      await page.goto(`${LIST}&after=${UNKNOWN}`);
      await expect(page.getByText("No more people to show.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to the first page" })).toBeVisible();

      // A plain search (the admins' search, GET /admin/users) pages the same way: once cut at
      // 20 with no way on.
      await page.goto(`/admin/people?q=${PREFIX.toLowerCase()}`);
      await expect(rows(page)).toHaveCount(50);
      await expect(page.getByText("50 people shown.")).toBeVisible();
      await page.getByRole("link", { name: "More people" }).click();
      await expect(page).toHaveURL(/[?&]after=/);
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText(`${PREFIX} 051`);
      await expect(page.getByRole("link", { name: "More people" })).toHaveCount(0);

      // Cancelling an invite on a later page stays on that page with the same search (it once
      // went back to the first page).
      const last = `${PREFIX} 051`;
      const page2 = new URL(page.url()).searchParams;
      const cancel = page.getByRole("dialog", { name: `Cancel ${last}'s invite?` });
      const button = rows(page)
        .first()
        .getByRole("button", { name: `Cancel invite: ${last}` });
      // Retried: a click before the page hydrates opens nothing.
      await expect(async () => {
        if (!(await cancel.isVisible())) await button.click();
        await expect(cancel).toBeVisible({ timeout: 1_000 });
      }).toPass();
      await cancel.getByRole("button", { name: "Cancel invite" }).click();
      await expect(
        page.getByText("Invite cancelled. The emailed set-up link no longer works."),
      ).toBeVisible();
      const after = new URL(page.url()).searchParams;
      expect(after.get("after")).toBe(page2.get("after"));
      expect(after.get("q")).toBe(PREFIX.toLowerCase());
      await expect(page.getByText("No more people to show.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to the first page" })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await removeAll(request, headers);
    }
  });
});
