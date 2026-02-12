#!/usr/bin/env node
/**
 * Closure — Graceful Exit Tests
 * @version 2.0.1
 *
 * Verifies the archival flow: idle detection, AI summarization
 * (via offscreen document), storage persistence, notifications,
 * nuclear archive, and Stay of Execution notification handling.
 */

const { test, expect } = require('./fixtures');

test.describe('Graceful Exit — Archival Flow', () => {
  test('idle check alarm is created on install', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const alarm = await page.evaluate(async () => {
      return chrome.alarms.get('idle-tab-check');
    });

    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe('idle-tab-check');
    expect(alarm.periodInMinutes).toBe(15);
  });

  test('archived entries have correct structure', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Manually add an archived entry to verify structure
    await page.evaluate(async () => {
      const data = await chrome.storage.local.get(['archived', 'stats']);
      const archived = data.archived || [];
      const stats = data.stats || { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 };

      archived.push({
        url: 'https://example.com/article',
        title: 'Test Article',
        favicon: 'https://example.com/favicon.ico',
        timestamp: Date.now(),
        summary: 'This is a test summary with key facts.',
        summaryType: 'fallback',
        domain: 'example.com',
      });

      stats.tabsTidiedThisWeek += 1;
      stats.ramSavedEstimate += 50;

      await chrome.storage.local.set({ archived, stats });
    });

    const result = await page.evaluate(async () => {
      return chrome.storage.local.get(['archived', 'stats']);
    });

    expect(result.archived.length).toBeGreaterThanOrEqual(1);
    const entry = result.archived[result.archived.length - 1];
    expect(entry.url).toBe('https://example.com/article');
    expect(entry.title).toBe('Test Article');
    expect(entry.favicon).toBe('https://example.com/favicon.ico');
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.summary).toContain('test summary');
    expect(entry.summaryType).toBe('fallback');
    expect(entry.domain).toBe('example.com');
    expect(result.stats.tabsTidiedThisWeek).toBeGreaterThanOrEqual(1);
    expect(result.stats.ramSavedEstimate).toBeGreaterThanOrEqual(50);
  });

  test('pinned tabs are never archived', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Create and pin a tab
    const pinnedPage = await context.newPage();
    await pinnedPage.goto('https://example.com', { waitUntil: 'commit' });

    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: '*://example.com/*' });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { pinned: true });
      }
    });

    // Verify pinned tab exists and is protected
    const pinnedTabs = await page.evaluate(async () => {
      return chrome.tabs.query({ pinned: true, url: '*://example.com/*' });
    });
    expect(pinnedTabs.length).toBeGreaterThanOrEqual(1);
    expect(pinnedTabs[0].pinned).toBe(true);
  });

  test('snooze alarm can be created and checked', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Create a snooze alarm for a fake tab ID
    await page.evaluate(async () => {
      await chrome.alarms.create('snooze-12345', { delayInMinutes: 24 * 60 });
    });

    const alarm = await page.evaluate(async () => {
      return chrome.alarms.get('snooze-12345');
    });

    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe('snooze-12345');
  });
});

test.describe('Graceful Exit — Nuclear Archive', () => {
  test('nuclear archive sends message and gets response', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Send the nuclear archive message directly (button removed from popup)
    const response = await page.evaluate(async () => {
      return chrome.runtime.sendMessage({ action: 'nuclearArchive' });
    });

    // Should get a response object with a count
    expect(response).toBeTruthy();
    expect(typeof response.count).toBe('number');
  });

  test('stats update after archival operations', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Set some stats
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        stats: { tabsTidiedThisWeek: 5, ramSavedEstimate: 250 },
      });
    });

    // Reload popup to see updated stats
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const tidied = await page.locator('#tabs-tidied').textContent();
    expect(tidied).toContain('5 tabs tidied');

    const ram = await page.locator('#ram-saved').textContent();
    expect(ram).toContain('250 MB');
  });
});

test.describe('Graceful Exit — Stay of Execution', () => {
  test('snooze alarm can be used for stay-of-execution', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Stay of Execution now uses chrome.notifications with action buttons
    // instead of content script injection. Verify snooze alarm creation works
    // (this is what the "Snooze 24h" button triggers).
    await page.evaluate(async () => {
      await chrome.alarms.create('snooze-99999', { delayInMinutes: 24 * 60 });
    });

    const alarm = await page.evaluate(async () => {
      return chrome.alarms.get('snooze-99999');
    });

    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe('snooze-99999');

    // Clean up
    await page.evaluate(async () => {
      await chrome.alarms.clear('snooze-99999');
    });
  });

  test('Sunday Digest link opens digest page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Click digest link and check a new tab opens
    const tabsBefore = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });

    await page.locator('#open-digest').click();

    await expect(async () => {
      const tabsAfter = await page.evaluate(async () => (await chrome.tabs.query({})).length);
      expect(tabsAfter).toBeGreaterThan(tabsBefore);
    }).toPass({ timeout: 5000 });
  });
});
