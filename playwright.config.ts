import { defineConfig } from "@playwright/test";

const DEFAULT_E2E_PORT = 43993;
const rawPort = process.env.REMEDENCE_PLATFORM_E2E_PORT;
const e2ePort = rawPort === undefined ? DEFAULT_E2E_PORT : Number(rawPort);

if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
  throw new Error(
    "REMEDENCE_PLATFORM_E2E_PORT must be an integer from 1024 through 65535.",
  );
}

const e2eHost = "127.0.0.1";
const e2eBaseUrl = `http://${e2eHost}:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: e2eBaseUrl,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev --workspace=@remedence/web -- --host ${e2eHost} --port ${e2ePort} --strictPort`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
