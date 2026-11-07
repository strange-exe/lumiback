import { test as setup } from "@playwright/test";

import {
  ADMIN_STATE,
  DEVELOPER_STATE,
  HEAD_WARDEN_STATE,
  STUDENT_STATE,
  WARDEN_STATE,
} from "../playwright.config";
import { ADMIN, DEVELOPER, HEAD_WARDEN, signIn, WARDEN } from "./helpers";

setup("sign in once as the seeded student", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: STUDENT_STATE });
});

setup("sign in once as the seeded admin", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.context().storageState({ path: ADMIN_STATE });
});

setup("sign in once as the seeded warden", async ({ page }) => {
  await signIn(page, WARDEN);
  await page.context().storageState({ path: WARDEN_STATE });
});

setup("sign in once as the seeded head warden", async ({ page }) => {
  await signIn(page, HEAD_WARDEN);
  await page.context().storageState({ path: HEAD_WARDEN_STATE });
});

// Sign-ins are limited to 20 per 15 minutes per address, and the whole suite runs from one:
// the View as and Status tests share this developer session instead of signing in each.
setup("sign in once as the seeded developer", async ({ page }) => {
  await signIn(page, DEVELOPER);
  await page.context().storageState({ path: DEVELOPER_STATE });
});
