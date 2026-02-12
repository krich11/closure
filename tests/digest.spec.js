const { test, expect } = require('./fixtures');

/**
 * Sunday Digest — Rendering & Interaction Tests
 *
 * Verify that archived entries render as cards, restore button
 * works, sort control toggles between recency and domain,
 * and stats display correctly.
 *
 * Seeding pattern: navigate to digest.html, seed storage via
 * evaluate(), then reload — avoids opening a separate seed page.
 */

// ─── Helper: seed storage and reload digest ────────────────────
async function seedAndReload(page, extensionId, data) {
  await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
  await page.evaluate(async (d) => chrome.storage.local.set(d), data);
  await page.reload();
}

test.describe('Digest — Rendering Archived Entries', () => {
  test('archived entries render as cards grouped by domain', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [
          {
            url: 'https://example.com/page1',
            title: 'Example Page 1',
            favicon: '',
            timestamp: Date.now() - 10000,
            summary: 'First example page summary.',
            summaryType: 'fallback',
            domain: 'example.com',
          },
          {
            url: 'https://example.com/page2',
            title: 'Example Page 2',
            favicon: '',
            timestamp: Date.now(),
            summary: 'Second example page summary.',
            summaryType: 'fallback',
            domain: 'example.com',
          },
          {
            url: 'https://other.org/article',
            title: 'Other Article',
            favicon: '',
            timestamp: Date.now() - 5000,
            summary: 'An article from another domain.',
            summaryType: 'fallback',
            domain: 'other.org',
          },
        ],
        stats: { tabsTidiedThisWeek: 3, ramSavedEstimate: 150 },
    });

    await expect(page.locator('.archive-card').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.archive-card')).toHaveCount(3);
    await expect(page.locator('.archive-group')).toHaveCount(2);
  });

  test('empty state message shown when no archived entries', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [],
      stats: { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 },
    });

    await expect(page.locator('#archive-feed .empty-state')).toBeVisible({ timeout: 5000 });
  });

  test('cards display title, summary, and timestamp', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [{
        url: 'https://example.com/detailed',
        title: 'Detailed Test Card',
        favicon: '',
        timestamp: Date.now(),
        summary: 'This is a detailed summary for testing card rendering.',
        summaryType: 'ai',
        domain: 'example.com',
      }],
      swept: [],
      stats: { tabsTidiedThisWeek: 1, ramSavedEstimate: 50 },
    });

    await expect(page.locator('.archive-card').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.card-title').first()).toContainText('Detailed Test Card');
    await expect(page.locator('.card-summary').first()).toContainText('detailed summary');
    await expect(page.locator('.card-timestamp').first()).toBeVisible();
  });

  test('group header shows uppercased domain name', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [{
        url: 'https://mysite.io/page',
        title: 'MySite Page',
        favicon: '',
        timestamp: Date.now(),
        summary: 'A page from mysite.io.',
        summaryType: 'fallback',
        domain: 'mysite.io',
      }],
      stats: { tabsTidiedThisWeek: 1, ramSavedEstimate: 50 },
    });

    await expect(page.locator('.group-title').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.group-title').first()).toContainText('MYSITE.IO');
  });
});

test.describe('Digest — Restore Functionality', () => {
  test('restore button opens a new tab with the archived URL', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [{
        url: 'https://example.com/restore-me',
        title: 'Restore Me',
        favicon: '',
        timestamp: Date.now(),
        summary: 'A page to restore.',
        summaryType: 'fallback',
        domain: 'example.com',
      }],
      stats: { tabsTidiedThisWeek: 1, ramSavedEstimate: 50 },
    });

    await expect(page.locator('.archive-card').first()).toBeVisible({ timeout: 5000 });

    const tabsBefore = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });

    const restoreBtn = page.locator('.restore-btn').first();
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();
    await expect(restoreBtn).toHaveText('Restored', { timeout: 5000 });

    const tabsAfter = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });
    expect(tabsAfter).toBeGreaterThan(tabsBefore);
    await expect(restoreBtn).toBeDisabled();
  });

  test('restore group button opens all tabs in a domain group', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [
        {
          url: 'https://example.com/group1',
          title: 'Group 1',
          favicon: '',
          timestamp: Date.now(),
          summary: 'First.',
          summaryType: 'fallback',
          domain: 'example.com',
        },
        {
          url: 'https://example.com/group2',
          title: 'Group 2',
          favicon: '',
          timestamp: Date.now() - 1000,
          summary: 'Second.',
          summaryType: 'fallback',
          domain: 'example.com',
        },
      ],
      stats: { tabsTidiedThisWeek: 2, ramSavedEstimate: 100 },
    });

    await expect(page.locator('.archive-card').first()).toBeVisible({ timeout: 5000 });

    const tabsBefore = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });

    const restoreGroupBtn = page.locator('.restore-group-btn').first();
    await expect(restoreGroupBtn).toBeVisible();
    await restoreGroupBtn.click();
    await expect(restoreGroupBtn).toHaveText('All Restored', { timeout: 5000 });

    const tabsAfter = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });
    expect(tabsAfter).toBeGreaterThanOrEqual(tabsBefore + 2);
  });
});

test.describe('Digest — Sort Control', () => {
  test('sort control exists with recency and domain options', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);

    const sortSelect = page.locator('#sort-select');
    await expect(sortSelect).toBeVisible();

    // Verify options
    const options = await sortSelect.locator('option').allTextContents();
    expect(options).toContain('Recency');
    expect(options).toContain('Domain');
  });

  test('switching sort re-renders the feed', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await seedAndReload(page, extensionId, {
      archived: [
        {
          url: 'https://alpha.com/page',
          title: 'Alpha Page',
          favicon: '',
          timestamp: Date.now() - 20000,
          summary: 'Alpha summary.',
          summaryType: 'fallback',
          domain: 'alpha.com',
        },
        {
          url: 'https://zeta.com/page',
          title: 'Zeta Page',
          favicon: '',
          timestamp: Date.now(),
          summary: 'Zeta summary.',
          summaryType: 'fallback',
          domain: 'zeta.com',
        },
      ],
      stats: { tabsTidiedThisWeek: 2, ramSavedEstimate: 100 },
    });

    await expect(page.locator('.group-title').first()).toBeVisible({ timeout: 5000 });

    // Default sort is recency — zeta.com should be first (newest)
    await expect(page.locator('.group-title').first()).toHaveText('ZETA.COM');

    // Switch to domain sort
    await page.locator('#sort-select').selectOption('domain');
    await expect(page.locator('.group-title').first()).toContainText('ALPHA.COM');
  });
});

test.describe('Digest — Stats Display', () => {
  test('stats section displays correct values', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const items = [];
    for (let i = 0; i < 12; i++) {
      items.push({
        url: `https://d${i}.com/p`,
        title: `Page ${i}`,
        favicon: '',
        timestamp: Date.now() - i * 1000,
        summary: 'S',
        summaryType: 'fallback',
        domain: `d${i}.com`,
      });
    }
    await seedAndReload(page, extensionId, {
      config: { enableAI: true },
      archived: items,
      stats: { tabsTidiedThisWeek: 12, ramSavedEstimate: 600 },
    });

    await expect(page.locator('#total-archived')).toHaveText('12', { timeout: 5000 });

    // Wait for async topic extraction to complete (badge appears)
    await page.waitForSelector('#topics-badge:not([hidden])', { timeout: 3000 }).catch(() => {});

    expect(await page.locator('#ram-saved').textContent()).toBe('600 MB');
    expect(await page.locator('#topics-explored').textContent()).toBe('12');
    await expect(page.locator('#topics-badge')).toContainText('sites');
  });

  test('date header shows current date', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);

    const dateText = await page.locator('#digest-date').textContent();
    // Should contain the current year
    expect(dateText).toContain(String(new Date().getFullYear()));
  });
});

test.describe('Digest — Accessibility', () => {
  test('feed has correct aria role and label', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);

    const feed = page.locator('#archive-feed');
    expect(await feed.getAttribute('role')).toBe('feed');
    expect(await feed.getAttribute('aria-label')).toBe('Archived tabs');
  });

  test('page has correct language attribute', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);

    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });

  test('theme sort option is initially disabled (no window.ai)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);

    const themeOption = page.locator('#sort-theme-option');
    await expect(themeOption).toBeDisabled();
  });
});
