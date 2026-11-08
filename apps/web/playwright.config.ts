import { defineConfig } from "@playwright/test";

export const STUDENT_STATE = "e2e/.auth/student.json";
export const ADMIN_STATE = "e2e/.auth/admin.json";
export const WARDEN_STATE = "e2e/.auth/warden.json";
export const HEAD_WARDEN_STATE = "e2e/.auth/head-warden.json";
export const DEVELOPER_STATE = "e2e/.auth/developer.json";

/**
 * End-to-end and design checks against the real stack:
 *   - FastAPI on :8100 using the LOCAL test database (backend/scripts/e2e_server.py),
 *     started fresh for every run so data and rate limits never leak between runs
 *   - Next.js on :3000
 * The student and the admin each sign in once (setup project); tests reuse that session, as a real browser would,
 * instead of logging in dozens of times (which the backend would rightly rate-limit).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // On CI the github reporter also files each failure's error as a check annotation,
  // readable from the run page (and the API) without downloading the artifact.
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "e2e",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      timeout: 60_000,
      use: { storageState: STUDENT_STATE },
    },
  ],
  webServer: [
    {
      // E2E_DEMO=1 adds a busy sample hostel (for e2e/office.spec.ts screenshots).
      command: `uv run python scripts/e2e_server.py --reset --seed${process.env.E2E_DEMO ? " --demo" : ""}`,
      cwd: "../../backend",
      url: "http://127.0.0.1:8100/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 3000",
      url: "http://localhost:3000",
      // A server already on :3000 is usually `npm run dev` pointed at the dev API and its
      // database, without E2E_FAULTS: reusing it would run the suite against the wrong data.
      // So the run fails on a busy port unless you opt in with E2E_REUSE_WEB=1, for a server
      // you started yourself with BACKEND_URL=http://127.0.0.1:8100 and E2E_FAULTS=1.
      reuseExistingServer: process.env.E2E_REUSE_WEB === "1",
      timeout: 120_000,
      // E2E_FAULTS=1: tests may make the server's own API calls fail (src/lib/test-faults.ts).
      env: { BACKEND_URL: "http://127.0.0.1:8100", E2E_FAULTS: "1" },
    },
  ],
});
