import { test as base } from "@playwright/test";

export * from "@playwright/test";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/**
 * The e2e server's rules close at 23:59 IST and a tap-out needs a minute ahead, so every
 * check-out from 23:58 IST is refused "Try again tomorrow". A test starting this close to
 * midnight waits for the new IST day instead: the closing minutes plus the longest test.
 */
export const DAY_END_MARGIN_MS = 4 * 60 * 1000;

/** How long to wait before a test so it never runs into the IST day's end (0 most of the day). */
export function dayEndWait(now = Date.now()): number {
  const left = DAY_MS - ((now + IST_OFFSET_MS) % DAY_MS);
  return left <= DAY_END_MARGIN_MS ? left + 1000 : 0;
}

/** Every spec's `test`: as Playwright's, plus the day-end wait before each test. */
export const test = base.extend<{ dayEnd: void }>({
  dayEnd: [
    async ({}, use, testInfo) => {
      const wait = dayEndWait();
      if (wait > 0) {
        testInfo.setTimeout(testInfo.timeout + wait);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      await use();
    },
    { auto: true },
  ],
});
