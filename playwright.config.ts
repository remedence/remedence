import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:43174",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "npm run dev --workspace=@remedence/web -- --host 127.0.0.1 --port 43174",
    url: "http://127.0.0.1:43174",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
