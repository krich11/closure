const { test, expect } = require('./fixtures');

/**
 * Popup UI Tests
 *
 * Verify the Zen Popup renders correctly, shows accurate
 * status ring colors, and has proper accessibility.
 */

test.describe('Zen Popup', () => {
  test('status ring shows green for low tab count', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const health = await page.locator('#status-ring').getAttribute('data-health');
    // With only a few test tabs open, should be green (≤15)
    expect(health).toBe('green');
  });

  test('support link points to ko-fi', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const link = page.locator('#support-link');
    await expect(link).toBeVisible();
    expect(await link.textContent()).toBe('Support me to enable AI features');
    expect(await link.getAttribute('href')).toContain('ko-fi.com/s/28c3a8d852');
    expect(await link.getAttribute('rel')).toContain('noopener');
  });

  test('stats section is visible', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const statsSection = page.locator('#stats');
    await expect(statsSection).toBeVisible();

    const tidied = page.locator('#tabs-tidied');
    const ram = page.locator('#ram-saved');
    await expect(tidied).toBeVisible();
    await expect(ram).toBeVisible();
  });

  test('popup has correct semantic structure', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Main content area uses <main>
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Heading present
    const heading = page.locator('h1');
    expect(await heading.textContent()).toBe('Closure');

    // Language attribute set
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });
});
