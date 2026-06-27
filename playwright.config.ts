import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Hyland careers automation.
 * Runs Chromium in headed mode with a maximized window.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 120_000,

  use: {
    trace: 'on-first-retry',
    headless: false,
    viewport: null,
    launchOptions: {
      args: ['--start-maximized'],
    },
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
