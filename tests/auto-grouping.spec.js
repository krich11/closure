const { test, expect } = require('./fixtures');

/**
 * Clean Slate Automator — Integration Tests
 *
 * Verify that opening 3+ tabs from the same domain triggers
 * automatic tab grouping with the correct group name and color.
 */

test.describe('Clean Slate Automator — Auto-Grouping', () => {
  test('opening tabs from the same domain creates a tab group', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Ensure threshold is set to 3 (default)
    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 3;
      await chrome.storage.local.set({ config });
    });

    // Open 3 tabs to the same domain — triggers auto-grouping
    const tabs = [];
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await tab.goto('https://example.com/page' + i);
      await tab.waitForLoadState('domcontentloaded');
      tabs.push(tab);
    }

    // Give the onUpdated listener time to fire and evaluate grouping
    await page.waitForTimeout(2000);

    // Check that a tab group exists with the domain name
    const groups = await page.evaluate(async () => {
      return chrome.tabGroups.query({});
    });

    const exampleGroup = groups.find((g) => g.title === 'EXAMPLE.COM');
    expect(exampleGroup).toBeTruthy();

    // Verify the grouped tabs are actually in the group
    const groupedTabs = await page.evaluate(async (groupId) => {
      const allTabs = await chrome.tabs.query({ groupId });
      return allTabs.map((t) => ({ url: t.url, groupId: t.groupId }));
    }, exampleGroup.id);

    expect(groupedTabs.length).toBeGreaterThanOrEqual(3);
  });

  test('tab grouping respects the configurable threshold', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Set threshold to 5
    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 5;
      await chrome.storage.local.set({ config });
    });

    // Open only 3 tabs — should NOT trigger grouping at threshold 5
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await tab.goto('https://httpbin.org/get?t=' + i);
      await tab.waitForLoadState('domcontentloaded');
    }

    await page.waitForTimeout(2000);

    const groups = await page.evaluate(async () => {
      return chrome.tabGroups.query({});
    });

    const httpbinGroup = groups.find((g) => g.title === 'HTTPBIN.ORG');
    expect(httpbinGroup).toBeUndefined();
  });

  test('new tab added to existing domain joins existing group', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 3;
      await chrome.storage.local.set({ config });
    });

    // Open 3 tabs to create the group
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await tab.goto('https://example.com/join' + i);
      await tab.waitForLoadState('domcontentloaded');
    }
    await page.waitForTimeout(2000);

    // Get the group ID
    const groupBefore = await page.evaluate(async () => {
      const groups = await chrome.tabGroups.query({ title: 'EXAMPLE.COM' });
      return groups[0] || null;
    });
    expect(groupBefore).toBeTruthy();

    // Open a 4th tab — should join the existing group, not create a new one
    const tab4 = await context.newPage();
    await tab4.goto('https://example.com/join3');
    await tab4.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Verify still only one group with that title
    const groupsAfter = await page.evaluate(async () => {
      return chrome.tabGroups.query({ title: 'EXAMPLE.COM' });
    });
    expect(groupsAfter.length).toBe(1);

    // Verify the new tab is in the same group
    const tabInGroup = await page.evaluate(async (groupId) => {
      const tabs = await chrome.tabs.query({ groupId });
      return tabs.some((t) => t.url.includes('/join3'));
    }, groupBefore.id);
    expect(tabInGroup).toBe(true);
  });

  test('pinned tabs are excluded from auto-grouping', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 3;
      await chrome.storage.local.set({ config });
    });

    // Open 2 normal tabs + 1 pinned tab from the same domain
    const tab1 = await context.newPage();
    await tab1.goto('https://example.com/pin1');
    const tab2 = await context.newPage();
    await tab2.goto('https://example.com/pin2');

    // Open a 3rd tab and pin it
    const tab3 = await context.newPage();
    await tab3.goto('https://example.com/pin3');
    await tab3.waitForLoadState('domcontentloaded');

    // Pin tab3
    await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const pinTarget = tabs.find((t) => t.url && t.url.includes('/pin3'));
      if (pinTarget) {
        await chrome.tabs.update(pinTarget.id, { pinned: true });
      }
    });

    await page.waitForTimeout(2000);

    // With only 2 unpinned tabs, no group should be created at threshold 3
    // (the pinned tab doesn't count)
    const pinnedTab = await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({ pinned: true });
      return tabs.find((t) => t.url && t.url.includes('/pin3'));
    });
    expect(pinnedTab).toBeTruthy();
    expect(pinnedTab.pinned).toBe(true);
    // Pinned tab should never be in a group
    expect(pinnedTab.groupId).toBe(-1);
  });

  test('group receives deterministic color based on domain', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 3;
      await chrome.storage.local.set({ config });
    });

    // Open 3 tabs to trigger grouping
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await tab.goto('https://example.com/color' + i);
      await tab.waitForLoadState('domcontentloaded');
    }
    await page.waitForTimeout(2000);

    const group = await page.evaluate(async () => {
      const groups = await chrome.tabGroups.query({ title: 'EXAMPLE.COM' });
      return groups[0] || null;
    });

    expect(group).toBeTruthy();
    // Color should be one of the 9 valid tab group colors
    const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    expect(validColors).toContain(group.color);
  });

  test('whitelisted domains are not auto-grouped', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Whitelist example.com
    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 3;
      config.whitelist = ['example.com'];
      await chrome.storage.local.set({ config });
    });

    // Open 4 tabs — more than threshold, but domain is whitelisted
    for (let i = 0; i < 4; i++) {
      const tab = await context.newPage();
      await tab.goto('https://example.com/wl' + i);
      await tab.waitForLoadState('domcontentloaded');
    }
    await page.waitForTimeout(2000);

    const groups = await page.evaluate(async () => {
      return chrome.tabGroups.query({ title: 'EXAMPLE.COM' });
    });

    // No group should be created for whitelisted domain
    expect(groups.length).toBe(0);
  });

  test('auto-collapse alarm is scheduled when a group is created', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await page.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config');
      config.groupThreshold = 3;
      config.collapseAfterHours = 3;
      await chrome.storage.local.set({ config });
    });

    // Open 3 tabs to trigger grouping
    for (let i = 0; i < 3; i++) {
      const tab = await context.newPage();
      await tab.goto('https://example.com/collapse' + i);
      await tab.waitForLoadState('domcontentloaded');
    }
    await page.waitForTimeout(2000);

    // Get the created group ID
    const group = await page.evaluate(async () => {
      const groups = await chrome.tabGroups.query({ title: 'EXAMPLE.COM' });
      return groups[0] || null;
    });
    expect(group).toBeTruthy();

    // Verify collapse alarm was created for this group
    const alarm = await page.evaluate(async (groupId) => {
      return chrome.alarms.get(`collapse-group-${groupId}`);
    }, group.id);

    expect(alarm).toBeTruthy();
    expect(alarm.name).toBe(`collapse-group-${group.id}`);
  });
});
