import { test as setup } from "@playwright/test";

import { ADMIN_STATE, STUDENT_STATE } from "../playwright.config";
import { ADMIN, signIn } from "./helpers";

setup("sign in once as the seeded student", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: STUDENT_STATE });
});

setup("sign in once as the seeded admin", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.context().storageState({ path: ADMIN_STATE });
});
