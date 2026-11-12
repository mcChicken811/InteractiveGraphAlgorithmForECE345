import { defineConfig } from '@playwright/test';

const PORT = 5199;
/** Set by docker/playwright.Dockerfile. */
const IN_DOCKER = !!process.env.PLAYWRIGHT_IN_DOCKER;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // In Docker (`npm run test:e2e`): the image's bundled Chromium.
    // On the host (`npm run test:e2e:local`): the installed Google Chrome, so no download is needed.
    channel: IN_DOCKER ? undefined : 'chrome',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI && !IN_DOCKER,
  },
});
