import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { ADMIN_STATE, WARDEN_STATE } from "../playwright.config";
import { E2E_PASSWORD, signIn, watchForErrors } from "./helpers";

// The hostel office's account controls (turn off / on, edit details, cancel an invite) and
// "Add a person". Who may do what is covered by the backend's tests/test_accounts.py; here: the
// pages, end to end.
//
// Turning off uses Kabir Mehta (e2e-delete@geu.ac.in), whom no other spec signs in as until
// account.spec.ts deletes him; this file sorts before it, and every test turns him back on.

const KABIR = { name: "Kabir Mehta", email: "e2e-delete@geu.ac.in", password: E2E_PASSWORD };
const TURNED_OFF = "This account has been turned off. Ask your hostel office to turn it back on.";
const XSS = "<img src=x onerror=alert(1)>";

/** Any alert() would mean a name ran as HTML. */
function watchDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

/** WCAG A/AA problems on the page as it is now (dialogs open). */
async function axeProblems(page: Page): Promise<string[]> {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return axe.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}

/**
 * For review only: ACCOUNT_SHOTS=<dir> saves the current state at desktop and phone width, light
 * and dark (the design matrix in design.spec.ts covers the lists without a dialog).
 */
async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.ACCOUNT_SHOTS;
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
      await page.screenshot({
        path: `${dir}/${name}-${label}-${scheme}.png`,
        animations: "disabled",
      });
    }
  }
  if (size) await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: null });
}

async function open(browser: Browser, storageState: string | { cookies: []; origins: [] }) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** The person's row in the People list. */
function row(page: Page, name: string) {
  return page.getByRole("listitem").filter({ hasText: name });
}

/**
 * Clicks a button that opens a dialog by script until the dialog shows: a click that lands
 * before the page's scripts run (People hydrates a lot) does nothing.
 */
async function openDialog(button: Locator, dialog: Locator): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

/** Leaves Kabir's account on, whatever a failed test left behind. */
async function turnKabirOn(page: Page): Promise<void> {
  await page.goto("/admin/people?q=kabir");
  const kabir = row(page, KABIR.name);
  const on = kabir.getByRole("button", { name: "Turn on", exact: true });
  const off = kabir.getByRole("button", { name: `Turn off: ${KABIR.name}` });
  await expect(on.or(off)).toBeVisible(); // isVisible() doesn't wait for the page
  if (await on.isVisible()) {
    await on.click();
    await expect(off).toBeVisible();
  }
}

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_STATE });

  test("turn an account off: signed out, can't sign in, then turned back on", async ({
    page,
    browser,
  }) => {
    const errors = watchForErrors(page);
    const student = await open(browser, { cookies: [], origins: [] });
    try {
      await signIn(student.page, KABIR);

      await page.goto("/admin/people?q=kabir");
      const kabir = row(page, KABIR.name);
      await expect(kabir.getByRole("button", { name: "Send password link" })).toBeVisible();
      const dialog = page.getByRole("dialog", { name: `Turn off ${KABIR.name}'s account?` });
      await openDialog(kabir.getByRole("button", { name: `Turn off: ${KABIR.name}` }), dialog);
      await expect(dialog).toContainText("signed out on every phone and browser");
      await expect(dialog).toContainText("Their outings and history are kept.");
      expect(await axeProblems(page), "accessibility of the open dialog").toEqual([]);
      await shoot(page, "turn-off-dialog");

      // "Keep it on" closes it and gives focus back to the button that opened it.
      await dialog.getByRole("button", { name: "Keep it on" }).click();
      await expect(dialog).toBeHidden();
      await expect(kabir.getByRole("button", { name: `Turn off: ${KABIR.name}` })).toBeFocused();

      await kabir.getByRole("button", { name: `Turn off: ${KABIR.name}` }).click();
      await dialog.getByRole("button", { name: "Turn off" }).click();
      await expect(dialog).toBeHidden();
      await expect(kabir.getByText("Turned off", { exact: true })).toBeVisible();
      await expect(kabir).toContainText("Turned off.");
      // A password link would be refused (409): turn it on first.
      await expect(kabir.getByRole("button", { name: "Send password link" })).toHaveCount(0);

      // The "Turned off" list has him.
      await page.getByRole("link", { name: "Turned off" }).click();
      await expect(page).toHaveURL(/account=off/);
      await expect(row(page, KABIR.name)).toBeVisible();
      await shoot(page, "turned-off-list");

      // Signed out everywhere: his open browser lands on sign-in...
      await student.page.goto("/home");
      await expect(student.page).toHaveURL(/\/sign-in/);
      // ...and signing in again (right password) shows the backend's message as is.
      await student.page.getByLabel("University email").fill(KABIR.email);
      await student.page.getByLabel("Password", { exact: true }).fill(KABIR.password);
      await student.page.getByRole("button", { name: "Sign in" }).click();
      await expect(student.page.getByText(TURNED_OFF, { exact: true })).toBeVisible();
      await expect(student.page).toHaveURL(/\/sign-in/);

      // Back on: he can sign in again.
      await row(page, KABIR.name).getByRole("button", { name: "Turn on", exact: true }).click();
      await expect(row(page, KABIR.name)).toHaveCount(0); // no longer in the "off" list
      await page.goto("/admin/people?q=kabir");
      await expect(row(page, KABIR.name).getByText("Turned off", { exact: true })).toHaveCount(0);
      await signIn(student.page, KABIR);
      expect(errors).toEqual([]);
    } finally {
      await turnKabirOn(page);
      await student.close();
    }
  });

  test("add a student (name shown as text), the warden corrects them, then cancel the invite", async ({
    page,
    browser,
  }) => {
    const errors = watchForErrors(page);
    const alerts = watchDialogs(page);
    const id = `27${String(Date.now()).slice(-8)}`;
    const name = `${XSS} Tara ${id.slice(-4)}`;

    await page.goto("/admin/people");
    const add = page.getByRole("dialog", { name: "Add a person" });
    await openDialog(page.getByRole("button", { name: "Add a person" }), add);
    // A student: the student ID is needed, the email is optional, parents are offered.
    await expect(add.getByLabel("Student ID", { exact: true })).toHaveAttribute("required", "");
    await expect(add.getByText(/use their student ID address/)).toBeVisible();
    // A warden: the hostel becomes "Looks after", and parents go.
    await add.getByLabel("Role").selectOption("warden");
    await expect(add.getByLabel("Looks after")).toBeVisible();
    await expect(add.getByLabel("Parent's name")).toHaveCount(0);
    expect(await axeProblems(page), "accessibility of the add form (warden)").toEqual([]);
    await add.getByLabel("Role").selectOption("student");
    await expect(add.getByLabel("Hostel (optional)")).toBeVisible();
    expect(await axeProblems(page), "accessibility of the add form").toEqual([]);
    await shoot(page, "add-person-dialog");

    // A warden needs the hostel they look after (the browser asks before sending).
    await add.getByLabel("Role").selectOption("warden");
    await add.getByLabel("Name", { exact: true }).fill(`Warden ${id}`);
    await add.getByRole("button", { name: "Add and email link" }).click();
    expect(
      await add.getByLabel("Looks after").evaluate((el: HTMLSelectElement) => el.validity.valid),
    ).toBe(false);
    // The server's message on a 422, and the role and hostel they picked are kept.
    await add.getByLabel("Looks after").selectOption({ label: "Hostel 3" });
    await add.getByLabel("University email").fill(`w${id}@gmail.com`);
    await add.getByRole("button", { name: "Add and email link" }).click();
    await expect(add.getByRole("alert")).toContainText("Email:");
    await expect(add.getByLabel("Role")).toHaveValue("warden");
    await expect(add.getByLabel("Looks after")).not.toHaveValue("");
    await add.getByLabel("Role").selectOption("student");

    // The server's own message on a 422 (the row's problem), and what was typed is kept.
    await add.getByLabel("Name", { exact: true }).fill(name);
    await add.getByLabel("Student ID", { exact: true }).fill(id);
    await add.getByLabel("University email (optional)").fill("");
    await add.getByLabel("Hostel (optional)").selectOption({ label: "Hostel 3" });
    await add.getByLabel("Parent's name").fill("Ravi Rao"); // without the number
    await add.getByRole("button", { name: "Add and email link" }).click();
    await expect(add.getByRole("alert")).toContainText("Parent's number");
    await expect(add.getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(add.getByLabel("Role")).toHaveValue("student");
    await expect(add.getByLabel("Hostel (optional)")).not.toHaveValue("");

    await add.getByLabel("Parent's number").fill("91234 56789");
    await add.getByLabel("Phone (optional)").fill("98765 43210");
    await add.getByRole("button", { name: "Add and email link" }).click();
    await expect(add).toBeHidden();
    // The confirmation names the address (the list below it now shows them too).
    await expect(page.getByText(`A link to set up their account was emailed to`)).toContainText(
      `${id}@geu.ac.in`,
    );

    await page.getByRole("link", { name: "Show them" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${id}`));

    // The same person again: 409, said in the form.
    await page.getByRole("button", { name: "Add a person" }).click();
    await add.getByLabel("Name", { exact: true }).fill(name);
    await add.getByLabel("Student ID", { exact: true }).fill(id);
    await add.getByRole("button", { name: "Add and email link" }).click();
    await expect(add.getByRole("alert")).toHaveText("An account already uses this email");
    await add.getByRole("button", { name: "Close" }).click();

    const added = row(page, name);
    await expect(added.getByText("Hasn't set up")).toBeVisible();
    // The name is text, never HTML.
    await expect(added.getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    // An admin may change the email.
    await added.getByRole("button", { name: `Edit details: ${name}` }).click();
    const adminEdit = page.getByRole("dialog", { name: `Edit details: ${name}` });
    await expect(adminEdit.getByLabel("University email")).toHaveValue(`${id}@geu.ac.in`);
    await adminEdit.getByRole("button", { name: "Close" }).click();

    // "Hasn't set up" lists them.
    await page.goto("/admin/people?account=invited");
    await expect(row(page, name)).toBeVisible();
    await shoot(page, "invited-list");

    // The warden of Hostel 3 sees them: details and turn off, never the email or cancel.
    const warden = await open(browser, WARDEN_STATE);
    try {
      const wardenErrors = watchForErrors(warden.page);
      await warden.page.goto("/admin/people");
      const theirs = row(warden.page, name);
      await expect(theirs.getByText("Hasn't set up")).toBeVisible();
      await expect(theirs.getByRole("button", { name: `Turn off: ${name}` })).toBeVisible();
      await expect(theirs.getByRole("button", { name: /cancel invite/i })).toHaveCount(0);
      await expect(theirs.getByRole("button", { name: "Send password link" })).toHaveCount(0);
      await expect(warden.page.getByRole("button", { name: "Add a person" })).toHaveCount(0);
      await theirs.getByRole("button", { name: `Edit details: ${name}` }).click();
      const edit = warden.page.getByRole("dialog", { name: `Edit details: ${name}` });
      await expect(edit.getByLabel("Name", { exact: true })).toHaveValue(name);
      await expect(edit.getByLabel("University email")).toHaveCount(0);
      await expect(edit.getByLabel("Phone (optional)")).toHaveValue("+919876543210");
      expect(await axeProblems(warden.page), "accessibility of the warden's edit").toEqual([]);
      await shoot(warden.page, "warden-edit-dialog");
      await edit.getByLabel("Roll no. (optional)").fill(`R${id}`);
      await edit.getByRole("button", { name: "Save details" }).click();
      await expect(edit).toBeHidden();
      await expect(theirs).toContainText("Details saved.");
      await expect(theirs).toContainText(`R${id}`);
      expect(wardenErrors).toEqual([]);
    } finally {
      await warden.close();
    }

    // Cancel the invite: the row goes and the page says so.
    await page.goto(`/admin/people?q=${id}`);
    await row(page, name)
      .getByRole("button", { name: `Cancel invite: ${name}` })
      .click();
    const cancel = page.getByRole("dialog", { name: `Cancel ${name}'s invite?` });
    await expect(cancel).toContainText(`${id}@geu.ac.in`);
    expect(await axeProblems(page), "accessibility of the cancel dialog").toEqual([]);
    await cancel.getByRole("button", { name: "Cancel invite" }).click();
    await expect(
      page.getByText("Invite cancelled. The emailed set-up link no longer works."),
    ).toBeVisible();
    await expect(row(page, name)).toHaveCount(0);
    expect(alerts).toEqual([]);
    expect(errors).toEqual([]);
  });
});
