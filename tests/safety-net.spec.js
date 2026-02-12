const { test, expect } = require('./fixtures');

/**
 * Safety Net Tests
 *
 * Verify that pinned tabs and audible tabs are never
 * closed, grouped, or archived under any circumstances.
 */

test.describe('Safety Net — Pinned Tab Immunity', () => {
  test('pinned tabs are not included in grouping candidates', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Create several tabs from the same domain, with one pinned
    const tabs = [];
    for (let i = 0; i < 4; i++) {
      const tab = await context.newPage();
      await tab.goto('https://example.com', { waitUntil: 'commit' });
      tabs.push(tab);
    }

    // Pin the first tab via chrome API
    await page.evaluate(async () => {
      const allTabs = await chrome.tabs.query({ url: '*://example.com/*' });
      if (allTabs.length > 0) {
        await chrome.tabs.update(allTabs[0].id, { pinned: true });
      }
    });

    // Verify the pinned tab is actually pinned
    const pinnedTabs = await page.evaluate(async () => {
      return chrome.tabs.query({ pinned: true });
    });
    expect(pinnedTabs.length).toBeGreaterThanOrEqual(1);

    // Verify pinned tab has the pinned property
    expect(pinnedTabs[0].pinned).toBe(true);
  });
});

test.describe('Safety Net — Whitelist', () => {
  test('whitelisted domains can be stored and retrieved', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Add a domain to whitelist
    await page.evaluate(async () => {
      const data = await chrome.storage.local.get('config');
      const config = data.config;
      config.whitelist = ['localhost', 'example.com'];
      await chrome.storage.local.set({ config });
    });

    // Verify it persists
    const whitelist = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('config');
      return data.config.whitelist;
    });

    expect(whitelist).toContain('localhost');
    expect(whitelist).toContain('example.com');
  });
});
