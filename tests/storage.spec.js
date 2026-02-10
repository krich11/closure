const { test, expect } = require('./fixtures');

/**
 * Storage Schema Tests
 *
 * Verify storage operations work correctly and the schema
 * handles archived/swept data properly.
 */

test.describe('Storage Schema', () => {
  test('archived entries can be written and read', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const testEntry = {
      url: 'https://example.com/article',
      title: 'Test Article',
      favicon: 'https://example.com/favicon.ico',
      timestamp: Date.now(),
      summary: '• Point one\n• Point two\n• Point three',
      summaryType: 'fallback',
      domain: 'example.com',
    };

    await page.evaluate(async (entry) => {
      const data = await chrome.storage.local.get('archived');
      const archived = data.archived || [];
      archived.push(entry);
      await chrome.storage.local.set({ archived });
    }, testEntry);

    const result = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('archived');
      return data.archived;
    });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe(testEntry.url);
    expect(result[0].title).toBe(testEntry.title);
    expect(result[0].summaryType).toBe('fallback');
  });

  test('swept entries log reason correctly', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const sweptEntry = {
      url: 'https://broken.example.com/missing',
      title: '404 Not Found',
      timestamp: Date.now(),
      reason: 'HTTP 404 error detected',
    };

    await page.evaluate(async (entry) => {
      const data = await chrome.storage.local.get('swept');
      const swept = data.swept || [];
      swept.push(entry);
      await chrome.storage.local.set({ swept });
    }, sweptEntry);

    const result = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('swept');
      return data.swept;
    });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('404');
  });

  test('stats update correctly', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      await chrome.storage.local.set({
        stats: {
          tabsTidiedThisWeek: 42,
          ramSavedEstimate: 2100,
        },
      });
    });

    const stats = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('stats');
      return data.stats;
    });

    expect(stats.tabsTidiedThisWeek).toBe(42);
    expect(stats.ramSavedEstimate).toBe(2100);
  });

  test('config defaults are valid ranges', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const config = await page.evaluate(async () => {
      const data = await chrome.storage.local.get('config');
      return data.config;
    });

    // groupThreshold: 3–10, default 3
    expect(config.groupThreshold).toBeGreaterThanOrEqual(3);
    expect(config.groupThreshold).toBeLessThanOrEqual(10);

    // idleThresholdHours: 4–168, default 24
    expect(config.idleThresholdHours).toBeGreaterThanOrEqual(4);
    expect(config.idleThresholdHours).toBeLessThanOrEqual(168);

    // collapseAfterHours: positive number
    expect(config.collapseAfterHours).toBeGreaterThan(0);
  });
});
