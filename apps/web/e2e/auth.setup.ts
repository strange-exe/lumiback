import { test as setup } from "@playwright/test";

import { STUDENT_STATE } from "../playwright.config";
import { signIn } from "./helpers";

setup("sign in once as the seeded student", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: STUDENT_STATE });
});
