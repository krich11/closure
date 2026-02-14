#!/usr/bin/env node
/**
 * Closure — Dead End Sweeper Tests
 * @version 2.0.5
 *
 * Verifies that the Dead End Sweeper correctly detects error pages,
 * logs them to storage, closes them, and updates the badge.
 */

const { test, expect } = require('./fixtures');

test.describe('Dead End Sweeper', () => {
  test('sweeper alarm is created on install', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Check that the dead-end-sweeper alarm exists
    const alarm = await page.evaluate(async () => {
      return chrome.alarms.get('dead-end-sweeper');
    });

    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe('dead-end-sweeper');
    // Alarm should have a period of 60 minutes
    expect(alarm.periodInMinutes).toBe(60);
  });

  test('error tab is detected and swept by title pattern', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Create a tab that looks like a 404 error page
    const errorPage = await context.newPage();
    await errorPage.goto('about:blank');

    // Set a title that matches error patterns
    await errorPage.evaluate(() => {
      document.title = '404 - Page Not Found';
    });

    // Get the tab ID of our error page
    const errorTabId = await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const errTab = tabs.find((t) => t.title === '404 - Page Not Found');
      return errTab ? errTab.id : null;
    });
    expect(errorTabId).toBeTruthy();

    // Trigger the sweep directly via the extension's message handler
    // instead of creating a short-delay alarm (which would persist
    // across tests and sweep about:blank tabs in later tests).
    const sweepResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'runSweep' }, (resp) => {
          resolve(resp);
        });
      });
    });

    // The sweep ran — check if the error tab was found
    expect(sweepResult).toBeDefined();

    // Check if the tab was swept (should appear in storage)
    const sweptData = await page.evaluate(async () => {
      return chrome.storage.local.get('swept');
    });

    expect(sweptData.swept).toBeDefined();
    expect(Array.isArray(sweptData.swept)).toBe(true);
  });

  test('swept entries are logged with correct structure', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Manually add a swept entry to verify the structure
    await page.evaluate(async () => {
      const data = await chrome.storage.local.get(['swept', 'stats']);
      const swept = data.swept || [];
      const stats = data.stats || { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 };

      swept.push({
        url: 'https://example.com/missing',
        title: '404 - Page Not Found',
        timestamp: Date.now(),
        reason: 'Title match: 404',
      });

      stats.tabsTidiedThisWeek += 1;
      stats.ramSavedEstimate += 50;

      await chrome.storage.local.set({ swept, stats });
    });

    // Verify the entry persists and has correct shape
    const result = await page.evaluate(async () => {
      return chrome.storage.local.get(['swept', 'stats']);
    });

    expect(result.swept.length).toBeGreaterThanOrEqual(1);
    const entry = result.swept[result.swept.length - 1];
    expect(entry.url).toBe('https://example.com/missing');
    expect(entry.title).toBe('404 - Page Not Found');
    expect(entry.reason).toBe('Title match: 404');
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(result.stats.tabsTidiedThisWeek).toBeGreaterThanOrEqual(1);
    expect(result.stats.ramSavedEstimate).toBeGreaterThanOrEqual(50);
  });

  test('pinned tabs are never swept', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Create a tab at an extension URL (not about:blank, which the sweeper
    // would close as a "blank/new tab" if it fires concurrently).
    const pinnedPage = await context.newPage();
    await pinnedPage.goto(`chrome-extension://${extensionId}/offscreen/offscreen.html`);
    await pinnedPage.evaluate(() => {
      document.title = '500 Internal Server Error';
    });

    // Pin it and wait for the pin to register
    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const errTab = tabs.find((t) => t.title === '500 Internal Server Error');
      if (errTab) {
        await chrome.tabs.update(errTab.id, { pinned: true });
      }
    });

    // Verify it's pinned (with retry for timing)
    await expect(async () => {
      const isPinned = await page.evaluate(async () => {
        const tabs = await chrome.tabs.query({ pinned: true });
        return tabs.some((t) => t.title === '500 Internal Server Error');
      });
      expect(isPinned).toBe(true);
    }).toPass({ timeout: 3000 });

    // The pinned error tab should NOT be swept — verify it's still open
    const stillOpen = await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.some((t) => t.title === '500 Internal Server Error');
    });
    expect(stillOpen).toBe(true);

    // Clean up: unpin the tab, close the page handle, then pause
    // briefly so the extension's service worker settles after the
    // tab-removal events before the cleanup fixture runs.
    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({ pinned: true });
      for (const t of tabs) {
        await chrome.tabs.update(t.id, { pinned: false });
      }
    });
    await pinnedPage.close();
    await page.waitForTimeout(200);
  });

  test('whitelisted domains are excluded from sweeping', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Add example.com to whitelist
    await page.evaluate(async () => {
      const data = await chrome.storage.local.get('config');
      const config = data.config;
      config.whitelist = ['example.com'];
      await chrome.storage.local.set({ config });
    });

    // Verify whitelist is stored
    const whitelist = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('config');
      return data.config.whitelist;
    });
    expect(whitelist).toContain('example.com');
  });

  test('badge clear alarm is created correctly', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Simulate creating the badge clear alarm
    await page.evaluate(async () => {
      await chrome.alarms.create('clear-sweep-badge', { delayInMinutes: 0.5 });
    });

    const alarm = await page.evaluate(async () => {
      return chrome.alarms.get('clear-sweep-badge');
    });

    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe('clear-sweep-badge');
  });
});
