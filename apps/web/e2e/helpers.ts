import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Seeded by backend/scripts/e2e_server.py into the local *_test database only. */
export const STUDENT = { email: "e2e@geu.ac.in", password: "lantern-at-dusk-2029" };
export const ADMIN = { email: "e2e-admin@geu.ac.in", password: "lantern-at-dusk-2029" };
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
  await page.getByRole("radio", { name: "+1 h" }).check({ force: true });
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

/** Create a join code on the share screen and return it as shown. */
export async function newJoinCode(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Get a join code|New code/ }).click();
  const code = page.getByText(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  await expect(code).toBeVisible();
  return (await code.textContent()) ?? "";
}
