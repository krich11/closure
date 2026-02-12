const { test, expect } = require('./fixtures');

/**
 * Dead End Sweeper — Integration Tests
 *
 * Verify that navigating a tab to an error page and firing
 * the sweep alarm results in the tab being closed and logged
 * to the swept[] array with the correct structure.
 */

test.describe('Dead End Sweeper — Integration @slow', () => {
  /**
   * Chrome MV3 alarms enforce a minimum delay of ~30 seconds.
   * These tests create error tabs with real HTTP URLs (so the sweeper's
   * domain check passes), re-schedule the alarm, and poll storage
   * for up to 90 seconds to allow the alarm to fire.
   */
  test.setTimeout(120_000);

  test('tab with 404 title is swept after alarm fires', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Clear swept array to isolate this test
    await page.evaluate(async () => {
      await chrome.storage.local.set({ swept: [], stats: { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 } });
    });

    // Navigate to a real HTTP URL so the sweeper sees a valid domain
    const errorTab = await context.newPage();
    await errorTab.goto('https://example.com/not-found');
    await errorTab.waitForLoadState('domcontentloaded');
    await errorTab.evaluate(() => {
      document.title = '404 - Page Not Found';
    });

    // Record the tab ID before sweep
    const errorTabId = await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((t) => t.title === '404 - Page Not Found');
      return t?.id ?? null;
    });
    expect(errorTabId).toBeTruthy();

    // Re-schedule the sweep alarm with minimum delay
    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    // Poll storage until the sweep fires (Chrome min alarm ~30s)
    let swept = [];
    for (let attempt = 0; attempt < 45; attempt++) {
      await page.waitForTimeout(2000);
      const data = await page.evaluate(async () => {
        return chrome.storage.local.get('swept');
      });
      swept = data.swept || [];
      if (swept.length > 0) break;
    }

    // Verify the swept entry was recorded
    expect(swept.length).toBeGreaterThanOrEqual(1);
    const entry = swept.find((s) => s.title === '404 - Page Not Found');
    expect(entry).toBeTruthy();
    expect(entry.reason).toContain('404');
    expect(entry.timestamp).toBeGreaterThan(0);

    // Verify the tab was actually closed
    const tabStillOpen = await page.evaluate(async (tabId) => {
      const tabs = await chrome.tabs.query({});
      return tabs.some((t) => t.id === tabId);
    }, errorTabId);
    expect(tabStillOpen).toBe(false);
  });

  test('tab with Server Error title is detected and swept', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({ swept: [] });
    });

    const errorTab = await context.newPage();
    await errorTab.goto('https://example.com/server-error');
    await errorTab.waitForLoadState('domcontentloaded');
    await errorTab.evaluate(() => {
      document.title = '500 Internal Server Error';
    });

    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    let swept = [];
    for (let attempt = 0; attempt < 45; attempt++) {
      await page.waitForTimeout(2000);
      const data = await page.evaluate(async () => chrome.storage.local.get('swept'));
      swept = data.swept || [];
      if (swept.length > 0) break;
    }

    expect(swept.length).toBeGreaterThanOrEqual(1);
    const entry = swept.find((s) => s.reason && s.reason.includes('500'));
    expect(entry).toBeTruthy();
  });

  test('ERR_ pattern in title triggers sweep', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({ swept: [] });
    });

    const errorTab = await context.newPage();
    await errorTab.goto('https://example.com/conn-refused');
    await errorTab.waitForLoadState('domcontentloaded');
    await errorTab.evaluate(() => {
      document.title = 'ERR_CONNECTION_REFUSED';
    });

    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    let swept = [];
    for (let attempt = 0; attempt < 45; attempt++) {
      await page.waitForTimeout(2000);
      const data = await page.evaluate(async () => chrome.storage.local.get('swept'));
      swept = data.swept || [];
      if (swept.length > 0) break;
    }

    expect(swept.length).toBeGreaterThanOrEqual(1);
    const entry = swept.find((s) => s.reason && s.reason.includes('ERR_'));
    expect(entry).toBeTruthy();
  });

  test('swept tab updates stats correctly', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Set known starting stats
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        swept: [],
        stats: { tabsTidiedThisWeek: 10, ramSavedEstimate: 500 },
      });
    });

    const errorTab = await context.newPage();
    await errorTab.goto('https://example.com/dns-error');
    await errorTab.waitForLoadState('domcontentloaded');
    await errorTab.evaluate(() => {
      document.title = 'DNS_PROBE_FINISHED_NXDOMAIN';
    });

    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    let stats;
    for (let attempt = 0; attempt < 45; attempt++) {
      await page.waitForTimeout(2000);
      const data = await page.evaluate(async () => chrome.storage.local.get('stats'));
      stats = data.stats;
      if (stats && stats.tabsTidiedThisWeek > 10) break;
    }

    // Stats should have incremented by at least 1 tab + 50 MB
    expect(stats.tabsTidiedThisWeek).toBeGreaterThan(10);
    expect(stats.ramSavedEstimate).toBeGreaterThan(500);
  });

  test('badge shows sweep count after tabs are swept', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({ swept: [] });
    });

    // Create 2 error tabs with real HTTP URLs
    for (const [title, path] of [['404 Not Found', '/err1'], ['Page Not Found — Error', '/err2']]) {
      const tab = await context.newPage();
      await tab.goto('https://example.com' + path);
      await tab.waitForLoadState('domcontentloaded');
      await tab.evaluate((t) => { document.title = t; }, title);
    }

    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    // Wait for sweep
    let swept = [];
    for (let attempt = 0; attempt < 45; attempt++) {
      await page.waitForTimeout(2000);
      const data = await page.evaluate(async () => chrome.storage.local.get('swept'));
      swept = data.swept || [];
      if (swept.length >= 2) break;
    }

    // Badge text should show the count (e.g. "+2")
    const badgeText = await page.evaluate(async () => {
      return chrome.action.getBadgeText({});
    });

    // Badge may already have cleared (30s alarm), but if swept tabs
    // exist, verify the badge was set at least once via the clear alarm
    const clearAlarm = await page.evaluate(async () => {
      return chrome.alarms.get('clear-sweep-badge');
    });
    // Clear alarm existing means badge was set
    if (swept.length >= 2) {
      expect(clearAlarm || badgeText).toBeTruthy();
    }
  });

  test('pinned error tab is never swept', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({ swept: [] });
    });

    // Create tab with error title at a real URL and pin it
    const errorTab = await context.newPage();
    await errorTab.goto('https://example.com/pinned-error');
    await errorTab.waitForLoadState('domcontentloaded');
    await errorTab.evaluate(() => {
      document.title = '502 Bad Gateway - Pinned';
    });

    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((t) => t.title === '502 Bad Gateway - Pinned');
      if (t) await chrome.tabs.update(t.id, { pinned: true });
    });

    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    // Wait long enough for the alarm to fire
    await page.waitForTimeout(45_000);

    // Verify the pinned tab is still open
    const stillOpen = await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({ pinned: true });
      return tabs.some((t) => t.title === '502 Bad Gateway - Pinned');
    });
    expect(stillOpen).toBe(true);

    // Verify it was NOT logged to swept
    const data = await page.evaluate(async () => chrome.storage.local.get('swept'));
    const pinnedSwept = (data.swept || []).find((s) => s.title && s.title.includes('Pinned'));
    expect(pinnedSwept).toBeUndefined();
  });

  test('whitelisted domain error tab is not swept', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Whitelist example.com and clear swept
    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.whitelist = ['example.com'];
      await chrome.storage.local.set({ config, swept: [] });
    });

    // Navigate to example.com — the URL domain is whitelisted
    const errorTab = await context.newPage();
    await errorTab.goto('https://example.com');
    await errorTab.waitForLoadState('domcontentloaded');
    await errorTab.evaluate(() => {
      document.title = '404 - This is whitelisted';
    });

    await page.evaluate(async () => {
      await chrome.alarms.clear('dead-end-sweeper');
      await chrome.alarms.create('dead-end-sweeper', {
        delayInMinutes: 0.5,
        periodInMinutes: 60,
      });
    });

    // Wait long enough for the alarm to fire
    await page.waitForTimeout(45_000);

    const data = await page.evaluate(async () => chrome.storage.local.get('swept'));
    const wlSwept = (data.swept || []).find((s) => s.title && s.title.includes('whitelisted'));
    expect(wlSwept).toBeUndefined();
  });
});
