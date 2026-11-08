import AxeBuilder from "@axe-core/playwright";
import { expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Seeded by backend/scripts/e2e_server.py into the local *_test database only. Every seeded
 * account shares this password; keep it equal to E2E_PASSWORD there.
 */
export const E2E_PASSWORD = "lantern@123";
export const STUDENT = { email: "e2e@geu.ac.in", password: E2E_PASSWORD };
export const ADMIN = { email: "e2e-admin@geu.ac.in", password: E2E_PASSWORD };
/** Warden of the seeded "Hostel 3". */
export const WARDEN = { email: "e2e-warden@geu.ac.in", password: E2E_PASSWORD };
export const HEAD_WARDEN = { email: "e2e-head@geu.ac.in", password: E2E_PASSWORD };
/** Seeded with the developer role (only a server script grants it): can view as others. */
export const DEVELOPER = { email: "e2e-dev@geu.ac.in", password: E2E_PASSWORD };
/** The seeded "North Gate" kiosk's device token (see e2e_server.py). */
export const KIOSK_TOKEN = "e2e-kiosk-token-north-gate-0000000000";
export const API = "http://127.0.0.1:8100";

export async function signIn(page: Page, who = STUDENT): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("University email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Make sure the student starts "in" (tests share one account). */
export async function ensureIn(page: Page): Promise<void> {
  await page.goto("/home");
  const back = page.getByRole("button", { name: "I'm back" });
  if (await back.isVisible()) {
    await back.click();
    await expect(page.getByRole("heading", { name: "Heading out?" })).toBeVisible();
  }
}

export async function checkOut(page: Page, destination: string): Promise<void> {
  await ensureIn(page);
  await page.getByLabel("Where to? (optional)").fill(destination);
  await page.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByRole("heading", { name: destination })).toBeVisible();
}

/** Collects console errors and failed requests for a page. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

/** Near Graphic Era's main gate. */
export const CAMPUS = { latitude: 30.2687, longitude: 77.9947, accuracy: 12 };

/** Grant location and place the device on campus (Chromium's geolocation emulation). */
export async function allowLocation(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(CAMPUS);
}

/** Serve map tiles locally so functional tests never depend on the tile CDN. */
export async function stubMapTiles(context: BrowserContext): Promise<void> {
  const blank = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  );
  await context.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: blank }),
  );
}

/** Make sure no share is running (tests share one student account). */
export async function stopSharing(page: Page): Promise<void> {
  // Reloading a sharing tab would itself end the share (tab-close beacon) mid-click.
  if (!page.url().endsWith("/share")) await page.goto("/share");
  const stop = page.getByRole("button", { name: "Stop sharing" });
  const start = page.getByRole("button", { name: "Start sharing" });
  // isVisible() doesn't wait: right after loading, neither button may be there yet, and a running
  // share would look like none. Wait for the page to show one of its two states first.
  await expect(stop.or(start)).toBeVisible();
  if (await stop.isVisible()) {
    await stop.click();
    await expect(page.getByRole("heading", { name: "Share your way back" })).toBeVisible();
  }
}

/** Start a 1-hour tab share from /share. Location must already be allowed. */
export async function startSharing(page: Page): Promise<void> {
  await stopSharing(page);
  await page.getByRole("button", { name: "Start sharing" }).click();
  await expect(page.getByRole("heading", { name: "You're sharing your location" })).toBeVisible();
  await expect(page.getByText(/^Live · updated/)).toBeVisible();
}

/** WCAG 2.2 A/AA problems on the page as it is now (open dialogs and bars included). */
export async function axeProblems(page: Page): Promise<string[]> {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return axe.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}

/**
 * DESIGN.md §6 for one state of a page: at 1440 and 390 wide, light and dark (each scheme
 * proven active first), no axe problems and no sideways scrolling. FEAT_SHOTS=<dir> also saves
 * a screenshot of each for review.
 */
export async function designMatrix(page: Page, name: string): Promise<void> {
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
      // A scheme flip starts colour transitions (the active nav link, buttons): fill and label
      // fade across each other for ~150 ms, and a fast runner's axe pass sampled that crossing.
      // Judge the resting colours: wait for running CSS transitions (never infinite loops),
      // at most 2 s so a transition that never settles can't stall the test.
      const settled = await page.evaluate(() =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a instanceof CSSTransition)
              .map((a) => a.finished.catch(() => undefined)),
          ).then(() => true),
          new Promise<boolean>((done) => setTimeout(() => done(false), 2_000)),
        ]),
      );
      expect(settled, `colour transitions settle (${name} ${label} ${scheme})`).toBe(true);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `no sideways scrolling (${name} ${label})`).toBe(false);
      expect(await axeProblems(page), `${name} ${label} ${scheme}`).toEqual([]);
      const dir = process.env.FEAT_SHOTS;
      if (dir) {
        await page.screenshot({
          path: `${dir}/${name}-${label}-${scheme}.png`,
          animations: "disabled",
        });
      }
    }
  }
  if (size) await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: null });
}

/** Create a join code on the share screen and return it as shown. */
export async function newJoinCode(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Get a join code|New code/ }).click();
  const code = page.getByText(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  await expect(code).toBeVisible();
  return (await code.textContent()) ?? "";
}
