const { test, expect } = require('./fixtures');

/**
 * Extension Loading & Initialization
 *
 * Verify the extension loads, service worker starts, and
 * storage is initialized with the correct schema.
 */

test.describe('Extension Initialization', () => {
  test('service worker starts and registers', async ({ extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(0);
  });

  test('storage schema is initialized on install', async ({ context, extensionId }) => {
    // Navigate to the extension's popup to access chrome.storage
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const storageData = await page.evaluate(async () => {
      return chrome.storage.local.get(null);
    });

    expect(storageData.schema_version).toBe(1);
    expect(storageData.config).toBeDefined();
    expect(storageData.config.groupThreshold).toBe(3);
    expect(storageData.config.idleThresholdHours).toBe(24);
    expect(storageData.config.whitelist).toEqual([]);
    expect(storageData.config.enableTopicGrouping).toBe(false);
    expect(storageData.config.topicGroupingIntervalMinutes).toBe(120);
    expect(storageData.config.topicGroupingOvernightOnly).toBe(false);
    expect(storageData.archived).toEqual([]);
    expect(storageData.swept).toEqual([]);
    expect(storageData.stats).toBeDefined();
    expect(storageData.stats.tabsTidiedThisWeek).toBe(0);
    expect(storageData.stats.ramSavedEstimate).toBe(0);
  });

  test('popup loads and displays tab count', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const tabCount = await page.locator('#tab-count').textContent();
    expect(tabCount).toMatch(/\d+ tabs open/);
  });

  test('popup has accessible elements', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Support link is a proper <a>
    const supportLink = page.locator('#support-link');
    await expect(supportLink).toBeVisible();
    expect(await supportLink.evaluate((el) => el.tagName)).toBe('A');

    // Status ring has aria-live for screen readers
    const ring = page.locator('#status-ring');
    expect(await ring.getAttribute('aria-live')).toBe('polite');
  });
});
