// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

/**
 * Playwright config for Closure Chrome extension testing.
 *
 * Chrome extensions cannot run in headless mode — they require a
 * persistent browser context launched with --load-extension. This
 * config uses a single Chromium project in headed mode.
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 8, // Each worker launches its own isolated Chromium instance
  reporter: [['list'], ['html', { open: 'never' }]],

  // Skip @slow-tagged tests by default (alarm-bound, 30-47s each).
  // Run them explicitly with: npm run test:slow
  // Run everything with: npm run test:all
  grepInvert: /@slow/,

  use: {
    // Headed mode is required for extension testing (MV3 service workers
    // don't load in headless Chromium).
    headless: false,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium-extension',
      use: {
        // The actual browser launch happens in the test fixture
        // (tests/fixtures.js) so we can pass --load-extension args.
        browserName: 'chromium',
      },
    },
  ],
});
