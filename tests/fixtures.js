const { test: base, chromium } = require('@playwright/test');
const path = require('path');

/**
 * Custom Playwright fixture that launches Chromium with the Closure
 * extension loaded. Provides:
 *
 *   context     – BrowserContext with extension loaded (worker-scoped)
 *   extensionId – the chrome-extension:// ID (worker-scoped)
 *
 * Worker-scoped means Chrome launches ONCE per worker and is reused
 * across all tests assigned to that worker. An auto-cleanup fixture
 * resets storage and closes stale pages between tests.
 *
 * Usage in tests:
 *   const { test, expect } = require('./fixtures');
 *   test('my test', async ({ context, extensionId }) => { ... });
 */

const EXTENSION_PATH = path.resolve(__dirname, '..');

// Use --headless=new by default for speed (no visible window, no focus stealing).
// Set HEADED=1 or use `npx playwright test --headed` to see the browser.
const isHeaded = process.env.HEADED === '1' || process.argv.includes('--headed');

/**
 * Default storage schema — mirrors DEFAULT_STORAGE in background.js.
 * Re-seeded between tests so each test starts with a clean slate
 * without needing a full Chrome restart.
 */
const DEFAULT_STORAGE = {
  schema_version: 1,
  config: {
    groupThreshold: 3,
    idleThresholdHours: 24,
    whitelist: [],
    enableAI: false,
    aiSupporterCode: '',
    aiActivated: false,
    enableThematicClustering: false,
    enableRichPageAnalysis: false,
    enableTopicGrouping: false,
    topicGroupingIntervalMinutes: 120,
    topicGroupingOvernightOnly: false,
    perWindowGrouping: false,
    highContrastMode: false,
    archiveRetentionDays: 0,
    archiveSortBy: 'recency',
  },
  archived: [],
  swept: [],
  stats: {
    tabsTidiedThisWeek: 0,
    ramSavedEstimate: 0,
  },
};

const test = base.extend({
  // ── Worker-scoped: Chrome launches once per worker ────────────
  _workerContext: [async ({}, use) => {
    const args = [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-infobars',
    ];

    if (!isHeaded) {
      args.unshift('--headless=new');
    }

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args,
    });

    await use(context);
    await context.close();
  }, { scope: 'worker' }],

  // ── Worker-scoped: extract extension ID once ──────────────────
  _workerId: [async ({ _workerContext }, use) => {
    let [background] = _workerContext.serviceWorkers();
    if (!background) {
      background = await _workerContext.waitForEvent('serviceworker');
    }

    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  }, { scope: 'worker' }],

  // ── Test-scoped pass-throughs (keeps test signatures unchanged) ─
  context: async ({ _workerContext }, use) => {
    await use(_workerContext);
  },

  extensionId: async ({ _workerId }, use) => {
    await use(_workerId);
  },

  // ── Test-scoped auto-cleanup: runs before EVERY test ──────────
  // Closes stale pages and resets storage to DEFAULT_STORAGE so
  // each test starts with the same clean state.
  _cleanup: [async ({ _workerContext, _workerId }, use) => {
    // Close all pages from previous test except page[0]
    const pages = _workerContext.pages();
    for (let i = pages.length - 1; i >= 1; i--) {
      if (!pages[i].isClosed()) {
        await pages[i].close().catch(() => {});
      }
    }

    // Use the surviving page (or create one) to reset storage
    let util = _workerContext.pages()[0];
    if (!util || util.isClosed()) {
      util = await _workerContext.newPage();
    }
    await util.goto(
      `chrome-extension://${_workerId}/offscreen/offscreen.html`,
      { waitUntil: 'domcontentloaded' },
    );
    await util.evaluate(async (defaults) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(defaults);
    }, DEFAULT_STORAGE);
    // Stay on the extension page (not about:blank, which the sweeper would close)

    await use();
  }, { auto: true }],
});

const expect = test.expect;

module.exports = { test, expect, DEFAULT_STORAGE };
