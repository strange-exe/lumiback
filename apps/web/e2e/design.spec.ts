import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ADMIN_STATE } from "../playwright.config";

import {
  allowLocation,
  checkOut,
  ensureIn,
  KIOSK_TOKEN,
  newJoinCode,
  startSharing,
  stopSharing,
  stubMapTiles,
  watchForErrors,
} from "./helpers";

/** DESIGN.md §6: desktop + mobile, light + dark, with screenshots for review. */
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;
const SHOTS = `e2e/shots/${process.env.SHOTS ?? "after"}`;

test.describe.configure({ timeout: 60_000 });

interface Screen {
  name: string;
  /** true: the seeded student; "admin": the seeded admin; false: signed out. */
  auth: boolean | "admin";
  prepare: (page: Page) => Promise<void>;
  /** The one thing that must be visible without scrolling. */
  primary: (page: Page) => ReturnType<Page["getByRole"] | Page["getByText"]>;
  cleanup?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "landing",
    auth: false,
    prepare: async (page) => void (await page.goto("/")),
    primary: (page) => page.getByRole("link", { name: "Create account" }).first(),
  },
  {
    name: "sign-in",
    auth: false,
    prepare: async (page) => void (await page.goto("/sign-in")),
    primary: (page) => page.getByRole("button", { name: "Sign in" }),
  },
  {
    name: "register",
    auth: false,
    prepare: async (page) => void (await page.goto("/register")),
    primary: (page) => page.getByRole("heading", { name: "Create your account" }),
  },
  {
    name: "forgot-password",
    auth: false,
    prepare: async (page) => void (await page.goto("/forgot-password")),
    primary: (page) => page.getByRole("button", { name: "Send code" }),
  },
  {
    name: "forgot-password-code",
    auth: false,
    prepare: async (page) =>
      void (await page.goto("/forgot-password?sent=1&email=new.student%40geu.ac.in")),
    primary: (page) => page.getByRole("button", { name: "Set new password" }),
  },
  {
    name: "verify",
    auth: false,
    prepare: async (page) => void (await page.goto("/verify?email=new.student%40geu.ac.in")),
    primary: (page) => page.getByRole("button", { name: "Verify email" }),
  },
  {
    name: "home-in",
    auth: true,
    prepare: ensureIn,
    primary: (page) => page.getByRole("button", { name: "Check out" }),
  },
  {
    name: "home-out",
    auth: true,
    prepare: (page) => checkOut(page, "Clock Tower market"),
    primary: (page) => page.getByRole("button", { name: "I'm back" }),
  },
  {
    name: "history",
    auth: true,
    prepare: async (page) => {
      await ensureIn(page);
      await page.goto("/history");
    },
    primary: (page) => page.getByRole("heading", { name: "Your outings" }),
  },
  {
    name: "account",
    auth: true,
    prepare: async (page) => void (await page.goto("/account")),
    primary: (page) => page.getByRole("heading", { name: "Account" }),
  },
  {
    name: "privacy",
    auth: false,
    prepare: async (page) => void (await page.goto("/privacy")),
    primary: (page) => page.getByRole("heading", { name: "Privacy", level: 1 }),
  },
  {
    name: "share-start",
    auth: true,
    prepare: stopSharing,
    primary: (page) => page.getByRole("button", { name: "Start sharing" }),
  },
  {
    name: "share-live",
    auth: true,
    prepare: async (page) => {
      await allowLocation(page.context());
      await startSharing(page);
    },
    primary: (page) => page.getByRole("heading", { name: "You're sharing your location" }),
    cleanup: stopSharing,
  },
  {
    name: "join",
    auth: false,
    prepare: async (page) => void (await page.goto("/join")),
    primary: (page) => page.getByRole("button", { name: "Ask to follow along" }),
  },
  {
    name: "watch-unavailable",
    auth: false,
    prepare: async (page) => {
      await page.goto("/watch/00000000-0000-4000-8000-000000000000");
      await expect(page.getByRole("heading", { name: "This share isn't available" })).toBeVisible();
    },
    primary: (page) => page.getByRole("link", { name: "Enter a new code" }),
  },
  {
    name: "gate-code",
    auth: false,
    prepare: async (page) =>
      void (await page.goto("/g/00000000-0000-4000-8000-000000000000.1.AAAAAAAAAA")),
    primary: (page) => page.getByRole("heading", { name: "Scan this in the Lumiback app" }),
  },
  {
    name: "kiosk",
    auth: false,
    prepare: async (page) => {
      await page.goto(`/kiosk#k=${KIOSK_TOKEN}`);
      await expect(page.getByRole("img", { name: "Gate code for North Gate" })).toBeVisible();
    },
    primary: (page) => page.getByRole("img", { name: "Gate code for North Gate" }),
  },
  {
    name: "admin-register",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin")),
    primary: (page) => page.getByRole("heading", { name: "Register", exact: true }),
  },
  {
    name: "admin-scans",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/scans")),
    primary: (page) => page.getByRole("heading", { name: "Gate scans" }),
  },
  {
    name: "admin-gates",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/gates")),
    primary: (page) => page.getByRole("heading", { name: "Gates", level: 1 }),
  },
  {
    name: "admin-people",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/people?q=sharma")),
    primary: (page) => page.getByRole("button", { name: "Make admin" }).first(),
  },
  {
    name: "admin-requests",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/requests")),
    primary: (page) => page.getByRole("heading", { name: "Outing requests" }),
  },
  {
    name: "admin-escalations",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/escalations")),
    primary: (page) => page.getByRole("heading", { name: "Escalations", level: 1 }),
  },
  {
    name: "admin-rules",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/rules")),
    primary: (page) => page.getByRole("heading", { name: "Outing rules" }),
  },
  {
    name: "admin-settings",
    auth: "admin",
    prepare: async (page) => void (await page.goto("/admin/settings")),
    primary: (page) => page.getByRole("button", { name: "Save settings" }),
  },
];

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    for (const screen of SCREENS) {
      test(`${screen.name} · ${viewport.name} · ${scheme}`, async ({
        page: studentPage,
        browser,
      }) => {
        const adminContext =
          screen.auth === "admin" ? await browser.newContext({ storageState: ADMIN_STATE }) : null;
        const page = adminContext ? await adminContext.newPage() : studentPage;
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme: scheme });
        if (!screen.auth) await page.context().clearCookies(); // public pages: signed out
        if (process.env.CI) await stubMapTiles(page.context()); // real tiles locally, for review
        const errors = watchForErrors(page);

        await screen.prepare(page);
        await page.waitForLoadState("networkidle");

        await expect(screen.primary(page)).toBeInViewport();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(overflow, "no horizontal scrolling").toBe(false);

        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const problems = axe.violations.map(
          (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
        );
        expect(problems, "accessibility violations").toEqual([]);

        await page.screenshot({
          path: `${SHOTS}/${screen.name}-${viewport.name}-${scheme}.png`,
          fullPage: true,
        });
        await screen.cleanup?.(page);
        await adminContext?.close();
        expect(errors, "console errors / failed requests").toEqual([]);
      });
    }
  }
}

/** The guest's live view needs a second browser, so it gets its own check (mobile, both themes). */
for (const scheme of SCHEMES) {
  test(`watch-live · mobile · ${scheme}`, async ({ page, browser }) => {
    await allowLocation(page.context());
    if (process.env.CI) await stubMapTiles(page.context());
    await startSharing(page);
    const code = await newJoinCode(page);

    const guestContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
      colorScheme: scheme,
    });
    if (process.env.CI) await stubMapTiles(guestContext);
    const guest = await guestContext.newPage();
    const errors = watchForErrors(guest);
    await guest.goto("/join");
    await guest.getByLabel("Join code").fill(code);
    await guest.getByLabel("Your name").fill("Mom");
    await guest.getByRole("button", { name: "Ask to follow along" }).click();
    await page.getByRole("button", { name: "Approve Mom (guest)" }).click({ timeout: 10_000 });
    await expect(guest.getByText(/^Live · updated/)).toBeVisible();
    await guest.waitForLoadState("networkidle");

    await expect(guest.getByRole("region", { name: /^Map/ })).toBeInViewport();
    const axe = await new AxeBuilder({ page: guest }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await guest.screenshot({ path: `${SHOTS}/watch-live-mobile-${scheme}.png`, fullPage: true });

    await stopSharing(page);
    await guestContext.close();
    expect(errors).toEqual([]);
  });
}

test("reduced motion: the lantern does not animate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await checkOut(page, "Library");
  const animation = await page
    .locator(".lantern-lit")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
  await page.screenshot({ path: `${SHOTS}/home-out-reduced-motion.png` });
  await ensureIn(page);
});
