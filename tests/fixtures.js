const { test: base, chromium } = require('@playwright/test');
const path = require('path');

/**
 * Custom Playwright fixture that launches Chromium with the Closure
 * extension loaded. Provides:
 *
 *   context   – BrowserContext with extension loaded
 *   extensionId – the chrome-extension:// ID for navigating to
 *                 popup, digest, settings, etc.
 *
 * Usage in tests:
 *   const { test, expect } = require('./fixtures');
 *   test('my test', async ({ context, extensionId }) => { ... });
 */

const EXTENSION_PATH = path.resolve(__dirname, '..');

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        // Required for extension loading in test environments
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Suppress first-run UI noise
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        // Disable the "Chrome is being controlled by automated software" bar
        '--disable-infobars',
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // MV3 service workers register as background pages.
    // Wait for the service worker to appear so we can extract the extension ID.
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker');
    }

    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});

const expect = test.expect;

module.exports = { test, expect };
