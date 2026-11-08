import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { test as setup, type Page } from "@playwright/test";

import {
  ADMIN_STATE,
  DEVELOPER_STATE,
  HEAD_WARDEN_STATE,
  STUDENT_STATE,
  WARDEN_STATE,
} from "../playwright.config";
import { ADMIN, DEVELOPER, HEAD_WARDEN, signIn, WARDEN } from "./helpers";

/**
 * Saves the session for every test of the run to reuse. The access cookie is kept for each
 * context's life (no 14-minute expiry): a refresh in one test would rotate the shared refresh
 * token and revoke it for all the others (reuse). The test API issues hour-long access tokens
 * (backend/scripts/e2e_server.py), longer than a full run.
 */
async function keep(page: Page, path: string): Promise<void> {
  const state = await page.context().storageState();
  for (const cookie of state.cookies) {
    if (cookie.name === "outing_at") cookie.expires = -1;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

setup("sign in once as the seeded student", async ({ page }) => {
  await signIn(page);
  await keep(page, STUDENT_STATE);
});

setup("sign in once as the seeded admin", async ({ page }) => {
  await signIn(page, ADMIN);
  await keep(page, ADMIN_STATE);
});

setup("sign in once as the seeded warden", async ({ page }) => {
  await signIn(page, WARDEN);
  await keep(page, WARDEN_STATE);
});

setup("sign in once as the seeded head warden", async ({ page }) => {
  await signIn(page, HEAD_WARDEN);
  await keep(page, HEAD_WARDEN_STATE);
});

// Sign-ins are limited to 20 per 15 minutes per address, and the whole suite runs from one:
// the View as and Status tests share this developer session instead of signing in each.
setup("sign in once as the seeded developer", async ({ page }) => {
  await signIn(page, DEVELOPER);
  await keep(page, DEVELOPER_STATE);
});
