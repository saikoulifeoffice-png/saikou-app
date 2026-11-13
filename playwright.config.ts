import { defineConfig, devices } from "@playwright/test";

/**
 * E2E テスト（ローカル Supabase + Next.js 本番ビルド）
 *   npx supabase start && npm run build && npm run test:e2e
 * 事前に .env.local（.env.example 参照）を用意すること。
 * インストール済みの Chromium を使う場合は PLAYWRIGHT_CHROMIUM_EXECUTABLE にパスを指定する。
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
      testMatch: /flow\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], launchOptions: { executablePath } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npm run start -- -p ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
