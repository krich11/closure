const { test, expect } = require('./fixtures');

/**
 * Privacy Regression Tests — Extended
 *
 * Verify that no external network requests are made from the
 * settings, onboarding, or digest pages. This extends the
 * original privacy.spec.js to cover all Phase 2 & 3 pages.
 */

test.describe('Privacy — Settings Page', () => {
  test('settings page makes no external network requests', async ({ context, extensionId }) => {
    const externalRequests = [];

    context.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('chrome-extension://') && !url.startsWith('chrome://') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);
    await page.waitForLoadState('networkidle');

    // Interact with the page to trigger any lazy loads
    await page.locator('#group-threshold').fill('5');
    await page.locator('#group-threshold').dispatchEvent('change');
    await page.locator('#whitelist-input').fill('test.com');
    await page.locator('#whitelist-add').click();
    await page.waitForTimeout(500);

    expect(externalRequests).toEqual([]);
  });

  test('settings page does not embed external resources', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);
    await page.waitForLoadState('domcontentloaded');

    // Check that no scripts or stylesheets reference external URLs
    const externalRefs = await page.evaluate(() => {
      const external = [];
      document.querySelectorAll('script[src], link[href]').forEach((el) => {
        const src = el.getAttribute('src') || el.getAttribute('href') || '';
        if (src.startsWith('http://') || src.startsWith('https://')) {
          external.push(src);
        }
      });
      return external;
    });

    expect(externalRefs).toEqual([]);
  });
});

test.describe('Privacy — Onboarding Page', () => {
  test('onboarding page makes no external network requests', async ({ context, extensionId }) => {
    const externalRequests = [];

    context.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('chrome-extension://') && !url.startsWith('chrome://') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('networkidle');

    // Navigate through all steps to trigger any lazy loading
    await page.locator('[data-next="step-permissions"]').click();
    await page.locator('[data-next="step-features"]').click();
    await page.locator('[data-next="step-ready"]').click();
    await page.waitForTimeout(500);

    expect(externalRequests).toEqual([]);
  });

  test('onboarding page does not embed external resources', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    const externalRefs = await page.evaluate(() => {
      const external = [];
      document.querySelectorAll('script[src], link[href]').forEach((el) => {
        const src = el.getAttribute('src') || el.getAttribute('href') || '';
        if (src.startsWith('http://') || src.startsWith('https://')) {
          external.push(src);
        }
      });
      return external;
    });

    expect(externalRefs).toEqual([]);
  });
});

test.describe('Privacy — Digest Page', () => {
  test('digest page makes no external network requests', async ({ context, extensionId }) => {
    const externalRequests = [];

    context.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('chrome-extension://') && !url.startsWith('chrome://') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    // Seed data to ensure full rendering path is exercised
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await seedPage.evaluate(async () => {
      await chrome.storage.local.set({
        archived: [{
          url: 'https://example.com/privacy-test',
          title: 'Privacy Test',
          favicon: '',
          timestamp: Date.now(),
          summary: 'Testing privacy.',
          summaryType: 'fallback',
          domain: 'example.com',
        }],
        stats: { tabsTidiedThisWeek: 1, ramSavedEstimate: 50 },
      });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('networkidle');

    // Exercise sort toggle
    await page.locator('#sort-select').selectOption('domain');
    await page.waitForTimeout(500);

    expect(externalRequests).toEqual([]);
  });

  test('digest page donation link is local only (no tracking redirect)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/digest/digest.html`);
    await page.waitForLoadState('domcontentloaded');

    // The donation link should be a direct URL, no tracking params
    const donationLink = page.locator('a[href*="ko-fi"]');
    const href = await donationLink.getAttribute('href');

    // Should be a clean URL with no analytics/UTM params
    expect(href).not.toContain('utm_');
    expect(href).not.toContain('ref=');

    // Should have rel="noopener noreferrer" for security
    const rel = await donationLink.getAttribute('rel');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });
});

test.describe('Privacy — Cross-Page Manifest Audit', () => {
  test('manifest has no host_permissions', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const manifest = await page.evaluate(async () => {
      const resp = await fetch(chrome.runtime.getURL('manifest.json'));
      return resp.json();
    });

    expect(manifest.host_permissions).toBeUndefined();
  });

  test('manifest content_security_policy has no external URLs', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const manifest = await page.evaluate(async () => {
      const resp = await fetch(chrome.runtime.getURL('manifest.json'));
      return resp.json();
    });

    const csp = manifest.content_security_policy;
    if (csp) {
      const cspStr = JSON.stringify(csp);
      expect(cspStr).not.toContain('http://');
      // Allow https://ko-fi.com only in the manifest if it's a link, not in CSP
      // CSP should not whitelist external script/connect sources
      expect(cspStr).not.toMatch(/connect-src.*https?:\/\/(?!self)/);
    }
  });

  test('no service worker fetch/XHR to external hosts', async ({ context, extensionId }) => {
    // Verify the background.js source code doesn't contain fetch or XMLHttpRequest
    // to external URLs
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const bgSource = await page.evaluate(async () => {
      const resp = await fetch(chrome.runtime.getURL('background.js'));
      return resp.text();
    });

    // No fetch() calls to external URLs (fetch to chrome-extension:// is fine)
    const fetchMatches = bgSource.match(/fetch\s*\(\s*['"`]https?:\/\//g);
    expect(fetchMatches).toBeNull();

    // No XMLHttpRequest
    expect(bgSource).not.toContain('XMLHttpRequest');

    // No WebSocket
    expect(bgSource).not.toContain('new WebSocket');
  });
});
