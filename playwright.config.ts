import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.PLAYWRIGHT_HOST ?? "localhost";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${HOST}:${PORT}`;
const useProductionServer = process.env.PLAYWRIGHT_USE_PRODUCTION_SERVER === "1";

const webServerCommand = useProductionServer
  ? `npm run start -- --hostname ${HOST} -p ${PORT}`
  : `npm run dev -- --hostname ${HOST} -p ${PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: /(api|e2e)\/.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? {}
    : {
        webServer: {
          command: webServerCommand,
          url: BASE_URL,
          // Production-mode verification must never attach to a stale server
          // from another checkout or with a different environment/database.
          reuseExistingServer: !process.env.CI && !useProductionServer,
          timeout: 120_000,
        },
      }),
});
