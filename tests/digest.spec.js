const { test, expect } = require('./fixtures');

/**
 * Sunday Digest — Rendering & Interaction Tests
 *
 * Verify that archived entries render as cards, restore button
 * works, sort control toggles between recency and domain,
 * and stats display correctly.
 */

test.describe('Digest — Rendering Archived Entries', () => {
  test('archived entries render as cards grouped by domain', async ({ context, extensionId }) => {
    // Seed archived data before loading digest
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
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
    });

    // Open digest
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Verify cards are rendered
    const cards = page.locator('.archive-card');
    await expect(cards).toHaveCount(3);

    // Verify domain groups
    const groups = page.locator('.archive-group');
    await expect(groups).toHaveCount(2); // example.com + other.org
  });

  test('empty state message shown when no archived entries', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
        archived: [],
        stats: { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 },
      });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const emptyState = page.locator('#archive-feed .empty-state');
    await expect(emptyState).toBeVisible();
  });

  test('cards display title, summary, and timestamp', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
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
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Verify card content
    const cardTitle = page.locator('.card-title').first();
    await expect(cardTitle).toContainText('Detailed Test Card');

    const cardSummary = page.locator('.card-summary').first();
    await expect(cardSummary).toContainText('detailed summary');

    const timestamp = page.locator('.card-timestamp').first();
    await expect(timestamp).toBeVisible();
  });

  test('group header shows uppercased domain name', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
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
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const groupTitle = page.locator('.group-title').first();
    await expect(groupTitle).toContainText('MYSITE.IO');
  });
});

test.describe('Digest — Restore Functionality', () => {
  test('restore button opens a new tab with the archived URL', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
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
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Count tabs before restore
    const tabsBefore = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });

    // Click restore button
    const restoreBtn = page.locator('.restore-btn').first();
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();
    await page.waitForTimeout(500);

    // Verify a new tab was opened
    const tabsAfter = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });
    expect(tabsAfter).toBeGreaterThan(tabsBefore);

    // Verify button text changed to "Restored"
    const btnText = await restoreBtn.textContent();
    expect(btnText).toBe('Restored');

    // Verify button is disabled
    await expect(restoreBtn).toBeDisabled();
  });

  test('restore group button opens all tabs in a domain group', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
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
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const tabsBefore = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });

    // Click "Restore Group" button
    const restoreGroupBtn = page.locator('.restore-group-btn').first();
    await expect(restoreGroupBtn).toBeVisible();
    await restoreGroupBtn.click();
    await page.waitForTimeout(1000);

    const tabsAfter = await page.evaluate(async () => {
      return (await chrome.tabs.query({})).length;
    });

    // Should have opened 2 tabs
    expect(tabsAfter).toBeGreaterThanOrEqual(tabsBefore + 2);

    // Button should show "All Restored"
    const btnText = await restoreGroupBtn.textContent();
    expect(btnText).toBe('All Restored');
  });
});

test.describe('Digest — Sort Control', () => {
  test('sort control exists with recency and domain options', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');

    const sortSelect = page.locator('#sort-select');
    await expect(sortSelect).toBeVisible();

    // Verify options
    const options = await sortSelect.locator('option').allTextContents();
    expect(options).toContain('Recency');
    expect(options).toContain('Domain');
  });

  test('switching sort re-renders the feed', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
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
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // Default sort is recency — zeta.com should be first (newest)
    const firstGroupRecency = await page.locator('.group-title').first().textContent();
    expect(firstGroupRecency).toBe('ZETA.COM');

    // Switch to domain sort
    await page.locator('#sort-select').selectOption('domain');
    await page.waitForTimeout(500);

    // Alpha should be first alphabetically
    const firstGroupDomain = await page.locator('.group-title').first().textContent();
    expect(firstGroupDomain).toBe('ALPHA.COM');
  });
});

test.describe('Digest — Stats Display', () => {
  test('stats section displays correct values', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
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
      await chrome.storage.local.set({
        archived: items,
        stats: { tabsTidiedThisWeek: 12, ramSavedEstimate: 600 },
      });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const totalArchived = await page.locator('#total-archived').textContent();
    expect(totalArchived).toBe('12');

    const ramSaved = await page.locator('#ram-saved').textContent();
    expect(ramSaved).toBe('600 MB');

    const topics = await page.locator('#topics-explored').textContent();
    expect(topics).toBe('12'); // 12 unique domains
  });

  test('date header shows current date', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');

    const dateText = await page.locator('#digest-date').textContent();
    // Should contain the year
    expect(dateText).toContain('2026');
  });

  test('donation footer displays topic count', async ({ context, extensionId }) => {
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
        archived: [
          { url: 'https://a.com/p', title: 'A', favicon: '', timestamp: Date.now(), summary: 'S', summaryType: 'fallback', domain: 'a.com' },
          { url: 'https://b.com/p', title: 'B', favicon: '', timestamp: Date.now(), summary: 'S', summaryType: 'fallback', domain: 'b.com' },
          { url: 'https://c.com/p', title: 'C', favicon: '', timestamp: Date.now(), summary: 'S', summaryType: 'fallback', domain: 'c.com' },
        ],
        stats: { tabsTidiedThisWeek: 3, ramSavedEstimate: 150 },
      });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const footerCount = await page.locator('#footer-topics-count').textContent();
    expect(footerCount).toBe('3'); // 3 unique domains
  });
});

test.describe('Digest — Accessibility', () => {
  test('feed has correct aria role and label', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');

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
    await page.waitForLoadState('domcontentloaded');

    const themeOption = page.locator('#sort-theme-option');
    await expect(themeOption).toBeDisabled();
  });
});
