import { defineConfig } from "@playwright/test";

export const STUDENT_STATE = "e2e/.auth/student.json";
export const ADMIN_STATE = "e2e/.auth/admin.json";

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
  reporter: [["list"]],
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
      command: "uv run python scripts/e2e_server.py --reset --seed",
      cwd: "../../backend",
      url: "http://127.0.0.1:8100/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --port 3000",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { BACKEND_URL: "http://127.0.0.1:8100" },
    },
  ],
});
