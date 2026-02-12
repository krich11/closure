const { test, expect } = require('./fixtures');

/**
 * Settings Page Tests
 *
 * Verify that sliders save to storage, whitelist add/remove works,
 * toggle persistence, and high-contrast mode is applied.
 */

test.describe('Settings Page — Slider Controls', () => {
  test('loads and displays current config values', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Verify the sliders exist and have default values
    const groupThreshold = await page.locator('#group-threshold').inputValue();
    expect(Number(groupThreshold)).toBeGreaterThanOrEqual(3);
    expect(Number(groupThreshold)).toBeLessThanOrEqual(10);

    const idleThreshold = await page.locator('#idle-threshold').inputValue();
    expect(Number(idleThreshold)).toBeGreaterThanOrEqual(4);
    expect(Number(idleThreshold)).toBeLessThanOrEqual(168);
  });

  test('changing group threshold saves to storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Change the slider value
    await page.locator('#group-threshold').fill('7');
    await page.locator('#group-threshold').dispatchEvent('change');

    // Verify it persisted to storage
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.groupThreshold).toBe(7);
    }).toPass({ timeout: 5000 });
  });

  test('changing idle threshold saves to storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    await page.locator('#idle-threshold').fill('48');
    await page.locator('#idle-threshold').dispatchEvent('change');

    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.idleThresholdHours).toBe(48);
    }).toPass({ timeout: 5000 });
  });

  test('slider output label updates on input', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    await page.locator('#group-threshold').fill('9');
    await page.locator('#group-threshold').dispatchEvent('input');
    await expect(page.locator('#group-threshold-value')).toHaveText('9');
  });
});

test.describe('Settings Page — Whitelist Management', () => {
  test('adding a domain to whitelist persists to storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Type a domain and click Add
    await page.locator('#whitelist-input').fill('testdomain.com');
    await page.locator('#whitelist-add').click();

    // Verify it's in storage
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.whitelist).toContain('testdomain.com');
    }).toPass({ timeout: 5000 });
  });

  test('adding domain via Enter key works', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    await page.locator('#whitelist-input').fill('enter-test.com');
    await page.locator('#whitelist-input').press('Enter');

    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.whitelist).toContain('enter-test.com');
    }).toPass({ timeout: 5000 });
  });

  test('removing a whitelisted domain updates storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Pre-seed a whitelist domain
    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.whitelist = ['removeme.com'];
      await chrome.storage.local.set({ config });
    });

    // Reload to pick up the seeded whitelist
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Click the remove button
    const removeBtn = page.locator('.whitelist-remove').first();
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // Verify it's removed from storage
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.whitelist).not.toContain('removeme.com');
    }).toPass({ timeout: 5000 });
  });

  test('duplicate domains are not added', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Add a domain
    await page.locator('#whitelist-input').fill('unique.com');
    await page.locator('#whitelist-add').click();
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.whitelist).toContain('unique.com');
    }).toPass({ timeout: 5000 });

    // Try adding the same domain again
    await page.locator('#whitelist-input').fill('unique.com');
    await page.locator('#whitelist-add').click();

    // Should only appear once
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      const count = config.whitelist.filter((d) => d === 'unique.com').length;
      expect(count).toBe(1);
    }).toPass({ timeout: 5000 });
  });

  test('URL protocol is stripped when adding domain', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    await page.locator('#whitelist-input').fill('https://www.stripped.com/path');
    await page.locator('#whitelist-add').click();

    // Should be stored as just "stripped.com" (protocol, www, and path removed)
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.whitelist).toContain('stripped.com');
    }).toPass({ timeout: 5000 });
  });

  test('empty whitelist shows empty state message', async ({ context, extensionId }) => {
    const page = await context.newPage();

    // Clear whitelist
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);
    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.whitelist = [];
      await chrome.storage.local.set({ config });
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const emptyMsg = page.locator('#whitelist-empty');
    await expect(emptyMsg).toBeVisible();
  });
});

test.describe('Settings Page — Toggles', () => {
  test('thematic clustering toggle saves to storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Enable AI first (sub-controls are gated behind master toggle)
    await page.locator('#enable-ai').click();
    // Enter a supporter code to activate
    await page.fill('#ai-license-input', 'CLOSURE-SUPPORTER-2026');
    await page.click('#ai-license-submit');
    await expect(page.locator('#ai-license-gate')).toBeHidden({ timeout: 5000 });

    const toggle = page.locator('#enable-clustering');
    await expect(toggle).toBeVisible();

    // Toggle it on
    await toggle.click();

    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.enableThematicClustering).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('topic grouping toggle saves to storage and shows options', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Enable AI first (topic grouping is AI-gated)
    await page.locator('#enable-ai').click();
    await page.fill('#ai-license-input', 'CLOSURE-SUPPORTER-2026');
    await page.click('#ai-license-submit');
    await expect(page.locator('#ai-license-gate')).toBeHidden({ timeout: 5000 });

    // Options should be hidden by default
    const options = page.locator('#topic-grouping-options');
    await expect(options).toBeHidden();

    // Toggle topic grouping on
    const toggle = page.locator('#enable-topic-grouping');
    await toggle.click();

    // Options should now be visible
    await expect(options).toBeVisible();

    // Verify saved to storage
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.enableTopicGrouping).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('topic grouping interval select saves to storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Enable AI first (topic grouping is AI-gated)
    await page.locator('#enable-ai').click();
    await page.fill('#ai-license-input', 'CLOSURE-SUPPORTER-2026');
    await page.click('#ai-license-submit');
    await expect(page.locator('#ai-license-gate')).toBeHidden({ timeout: 5000 });

    // Enable topic grouping first so options are visible
    await page.locator('#enable-topic-grouping').click();
    await expect(page.locator('#topic-grouping-options')).toBeVisible({ timeout: 5000 });

    // Change interval
    await page.locator('#topic-grouping-interval').selectOption('480');

    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.topicGroupingIntervalMinutes).toBe(480);
    }).toPass({ timeout: 5000 });
  });

  test('overnight toggle saves to storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Enable AI first (topic grouping is AI-gated)
    await page.locator('#enable-ai').click();
    await page.fill('#ai-license-input', 'CLOSURE-SUPPORTER-2026');
    await page.click('#ai-license-submit');
    await expect(page.locator('#ai-license-gate')).toBeHidden({ timeout: 5000 });

    // Enable topic grouping first
    await page.locator('#enable-topic-grouping').click();
    await expect(page.locator('#topic-grouping-options')).toBeVisible({ timeout: 5000 });

    // Toggle overnight on
    await page.locator('#topic-grouping-overnight').click();

    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.topicGroupingOvernightOnly).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('high-contrast toggle saves and applies class', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    const toggle = page.locator('#high-contrast');
    await toggle.click();

    // Verify class is applied to html element
    await expect(page.locator('html')).toHaveClass(/high-contrast/);

    // Verify stored in config
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.highContrastMode).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  test('toggle state persists across page reload', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    // Enable AI first
    await page.locator('#enable-ai').click();
    await page.fill('#ai-license-input', 'CLOSURE-SUPPORTER-2026');
    await page.click('#ai-license-submit');
    await expect(page.locator('#ai-license-gate')).toBeHidden({ timeout: 5000 });

    // Enable clustering
    await page.locator('#enable-clustering').click();
    await expect(async () => {
      const config = await page.evaluate(async () => {
        const data = await chrome.storage.local.get('config');
        return data.config;
      });
      expect(config.enableThematicClustering).toBe(true);
    }).toPass({ timeout: 5000 });

    // Reload
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Verify toggle is still on
    const ariaChecked = await page.locator('#enable-clustering').getAttribute('aria-checked');
    expect(ariaChecked).toBe('true');
  });
});

test.describe('Settings Page — Accessibility & Structure', () => {
  test('page has correct language attribute', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });

  test('all toggle buttons have role=switch', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    const toggles = page.locator('.toggle');
    const count = await toggles.count();

    for (let i = 0; i < count; i++) {
      const role = await toggles.nth(i).getAttribute('role');
      expect(role).toBe('switch');
    }
  });

  test('AI status indicator is present', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    const aiStatus = page.locator('#ai-status');
    await expect(aiStatus).toBeVisible();

    // In test env, AI is unavailable — should show unavailable message
    const text = await aiStatus.textContent();
    expect(text).toContain('not available');
  });

  test('save status element exists with aria-live', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    const saveStatus = page.locator('#save-status');
    const ariaLive = await saveStatus.getAttribute('aria-live');
    expect(ariaLive).toBe('polite');
  });

  test('range inputs have aria min/max attributes', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/settings/settings.html`);

    const groupSlider = page.locator('#group-threshold');
    expect(await groupSlider.getAttribute('aria-valuemin')).toBe('3');
    expect(await groupSlider.getAttribute('aria-valuemax')).toBe('10');
  });
});
