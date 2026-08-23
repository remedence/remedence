import { defineConfig } from "@playwright/test";

const DEFAULT_E2E_PORT = 43993;
const E2E_API_PORT = 43_180;
const rawPort = process.env.REMEDENCE_PLATFORM_E2E_PORT;
const e2ePort = rawPort === undefined ? DEFAULT_E2E_PORT : Number(rawPort);

if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
  throw new Error(
    "REMEDENCE_PLATFORM_E2E_PORT must be an integer from 1024 through 65535.",
  );
}

const e2eHost = "127.0.0.1";
const e2eBaseUrl = `http://${e2eHost}:${e2ePort}`;
const e2eApiBaseUrl = `http://${e2eHost}:${E2E_API_PORT}`;
const e2eDataDirectory = process.env.REMEDENCE_E2E_DATA_DIR?.trim();
if (!e2eDataDirectory) {
  throw new Error(
    "Run Playwright through bun run e2e so test data is isolated.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: e2eBaseUrl,
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      name: "api",
      command: "bun run --filter @remedence/api dev",
      url: `${e2eApiBaseUrl}/healthz`,
      env: {
        NODE_ENV: "development",
        REMEDENCE_API_PORT: String(E2E_API_PORT),
        REMEDENCE_DATA_DIR: e2eDataDirectory,
        REMEDENCE_DEV_ORIGIN: e2eBaseUrl,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      name: "web",
      command: `bun run --filter @remedence/web dev --host ${e2eHost} --port ${e2ePort} --strictPort`,
      url: e2eBaseUrl,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
