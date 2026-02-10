const { test, expect } = require('./fixtures');

/**
 * Onboarding Flow Tests
 *
 * Verify step navigation (4 steps), progress dots update,
 * and the close button marks onboarding as completed.
 */

test.describe('Onboarding — Step Navigation', () => {
  test('onboarding page loads with step 1 visible', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Step 1 (welcome) should be visible
    const step1 = page.locator('#step-welcome');
    await expect(step1).toBeVisible();

    // Other steps should be hidden
    await expect(page.locator('#step-permissions')).toBeHidden();
    await expect(page.locator('#step-features')).toBeHidden();
    await expect(page.locator('#step-ready')).toBeHidden();
  });

  test('clicking Next navigates to step 2', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Click the "Let's Set Things Up" button
    await page.locator('[data-next="step-permissions"]').click();

    // Step 2 should now be visible
    await expect(page.locator('#step-permissions')).toBeVisible();
    await expect(page.locator('#step-welcome')).toBeHidden();
  });

  test('clicking Back returns to previous step', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Go to step 2
    await page.locator('[data-next="step-permissions"]').click();
    await expect(page.locator('#step-permissions')).toBeVisible();

    // Click Back
    await page.locator('[data-prev="step-welcome"]').click();

    // Should be back on step 1
    await expect(page.locator('#step-welcome')).toBeVisible();
    await expect(page.locator('#step-permissions')).toBeHidden();
  });

  test('full navigation through all 4 steps', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Step 1 → 2
    await page.locator('[data-next="step-permissions"]').click();
    await expect(page.locator('#step-permissions')).toBeVisible();

    // Step 2 → 3
    await page.locator('[data-next="step-features"]').click();
    await expect(page.locator('#step-features')).toBeVisible();

    // Step 3 → 4
    await page.locator('[data-next="step-ready"]').click();
    await expect(page.locator('#step-ready')).toBeVisible();

    // All previous steps should be hidden
    await expect(page.locator('#step-welcome')).toBeHidden();
    await expect(page.locator('#step-permissions')).toBeHidden();
    await expect(page.locator('#step-features')).toBeHidden();
  });
});

test.describe('Onboarding — Progress Dots', () => {
  test('first dot is active on load', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    const firstDot = page.locator('[data-step="step-welcome"]');
    const hasActive = await firstDot.evaluate((el) => el.classList.contains('dot--active'));
    expect(hasActive).toBe(true);
  });

  test('dots update when navigating between steps', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Navigate to step 2
    await page.locator('[data-next="step-permissions"]').click();

    // Step 2 dot should be active, step 1 dot should not
    const dot1Active = await page.locator('[data-step="step-welcome"]').evaluate(
      (el) => el.classList.contains('dot--active')
    );
    const dot2Active = await page.locator('[data-step="step-permissions"]').evaluate(
      (el) => el.classList.contains('dot--active')
    );

    expect(dot1Active).toBe(false);
    expect(dot2Active).toBe(true);
  });

  test('all 4 progress dots exist', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    const dots = page.locator('.dot');
    await expect(dots).toHaveCount(4);
  });
});

test.describe('Onboarding — Close Button', () => {
  test('close button marks onboarding as completed in storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Navigate to the final step
    await page.locator('[data-next="step-permissions"]').click();
    await page.locator('[data-next="step-features"]').click();
    await page.locator('[data-next="step-ready"]').click();

    // The close button should be visible on step 4
    const closeBtn = page.locator('#close-onboarding');
    await expect(closeBtn).toBeVisible();

    // Click the button — it will close the tab via chrome.tabs.remove,
    // which destroys the page context. Wrap in try/catch.
    try {
      await closeBtn.click();
      // Give time for the storage write (may throw if page closed)
      await page.waitForTimeout(500);
    } catch {
      // Expected: page was destroyed by chrome.tabs.remove — that's fine
    }

    // Open a new page to check storage (onboarding tab was closed)
    const checkPage = await context.newPage();
    await checkPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const completed = await checkPage.evaluate(async () => {
      const data = await chrome.storage.local.get('onboarding_completed');
      return data.onboarding_completed;
    });

    expect(completed).toBe(true);
  });

  test('close button appears only on final step', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Close button should not be visible on step 1
    await expect(page.locator('#close-onboarding')).toBeHidden();

    // Navigate to step 4
    await page.locator('[data-next="step-permissions"]').click();
    await expect(page.locator('#close-onboarding')).toBeHidden();

    await page.locator('[data-next="step-features"]').click();
    await expect(page.locator('#close-onboarding')).toBeHidden();

    await page.locator('[data-next="step-ready"]').click();
    await expect(page.locator('#close-onboarding')).toBeVisible();
  });
});

test.describe('Onboarding — Content & Accessibility', () => {
  test('page has correct heading structure', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    const h1 = page.locator('#welcome-heading');
    await expect(h1).toBeVisible();
    expect(await h1.textContent()).toContain('Welcome to Closure');
  });

  test('page has correct language attribute', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);

    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });

  test('steps have aria-labelledby attributes', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    const steps = ['step-welcome', 'step-permissions', 'step-features', 'step-ready'];
    for (const stepId of steps) {
      const ariaLabel = await page.locator(`#${stepId}`).getAttribute('aria-labelledby');
      expect(ariaLabel).toBeTruthy();
    }
  });

  test('progress dots have aria-labels', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    const dots = page.locator('.dot');
    const count = await dots.count();
    for (let i = 0; i < count; i++) {
      const ariaLabel = await dots.nth(i).getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel).toContain('Step');
    }
  });

  test('permission list displays all 6 permissions', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Navigate to step 2 to see permission list
    await page.locator('[data-next="step-permissions"]').click();

    const permissions = page.locator('.permission-item');
    await expect(permissions).toHaveCount(6);
  });

  test('feature tour displays 4 feature cards', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForLoadState('domcontentloaded');

    // Navigate to step 3
    await page.locator('[data-next="step-permissions"]').click();
    await page.locator('[data-next="step-features"]').click();

    const cards = page.locator('.feature-card');
    await expect(cards).toHaveCount(4);
  });
});
