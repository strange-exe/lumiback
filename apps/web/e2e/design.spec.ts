import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { checkOut, ensureIn, watchForErrors } from "./helpers";

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
  auth: boolean;
  prepare: (page: Page) => Promise<void>;
  /** The one thing that must be visible without scrolling. */
  primary: (page: Page) => ReturnType<Page["getByRole"] | Page["getByText"]>;
}

const SCREENS: Screen[] = [
  {
    name: "landing",
    auth: false,
    prepare: async (page) => void (await page.goto("/")),
    primary: (page) => page.getByRole("button", { name: "Sign in" }),
  },
  {
    name: "register",
    auth: false,
    prepare: async (page) => void (await page.goto("/register")),
    primary: (page) => page.getByRole("heading", { name: "Create your account" }),
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
    primary: (page) => page.getByText("+2 h", { exact: true }),
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
];

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    for (const screen of SCREENS) {
      test(`${screen.name} · ${viewport.name} · ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme: scheme });
        if (!screen.auth) await page.context().clearCookies(); // public pages: signed out
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
        expect(errors, "console errors / failed requests").toEqual([]);
      });
    }
  }
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
