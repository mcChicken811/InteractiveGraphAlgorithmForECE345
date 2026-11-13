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
    // The static server serves the project from its root, like Live Server run from the repo root.
    baseURL: `http://127.0.0.1:${PORT}/`,
    // In Docker (`npm run test:e2e`): the image's bundled Chromium.
    // On the host (`npm run test:e2e:local`): the installed Google Chrome, so no download is needed.
    channel: IN_DOCKER ? undefined : 'chrome',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  webServer: {
    // Compile, then serve the files as-is (no dev-server magic), exactly as a user's
    // static server would. Never reuse a running server, so the build is always fresh.
    command: `npm run build && node scripts/static-server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
