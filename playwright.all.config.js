// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Full Playwright config — includes ALL tests, even slow integration
 * tests that navigate to external URLs. Use this for comprehensive
 * pre-release validation:
 *
 *   npm run test:all
 */
const baseConfig = require('./playwright.config.js');

module.exports = defineConfig({
  ...baseConfig,
  grepInvert: undefined, // Run everything, including @slow
  timeout: 120_000, // Longer timeout for alarm-bound tests
});
