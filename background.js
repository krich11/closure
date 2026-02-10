/**
 * Closure — Service Worker (background.js)
 *
 * Manages tab grouping (Clean Slate Automator), error sweeping,
 * archival orchestration, and alarm scheduling.
 * All event listeners registered synchronously at top level
 * so they survive service worker restarts.
 */

const DEFAULT_CONFIG = {
  groupThreshold: 3,
  idleThresholdHours: 24,
  collapseAfterHours: 3,
  whitelist: [],
  enableThematicClustering: false,
  highContrastMode: false,
};

const DEFAULT_STORAGE = {
  schema_version: 1,
  config: DEFAULT_CONFIG,
  archived: [],
  swept: [],
  stats: {
    tabsTidiedThisWeek: 0,
    ramSavedEstimate: 0,
  },
};

// ─── Available tab group colors (deterministic cycling) ──────────
const GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green',
  'pink', 'purple', 'cyan', 'orange',
];

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract a grouping-friendly domain from a URL.
 * Strips "www." prefix so www.example.com and example.com group together.
 * Returns null for chrome://, about:, and other non-http(s) URLs.
 */
function getRootDomain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Simple string hash → deterministic index into GROUP_COLORS.
 * Uses djb2 so the same domain always gets the same color.
 */
function domainToColorIndex(domain) {
  let hash = 5381;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) + hash + domain.charCodeAt(i)) >>> 0;
  }
  return hash % GROUP_COLORS.length;
}

/**
 * Check whether a domain is whitelisted.
 */
async function isDomainWhitelisted(domain) {
  const { config } = await chrome.storage.local.get('config');
  const whitelist = config?.whitelist ?? [];
  return whitelist.includes(domain);
}

// ─── Clean Slate Automator ──────────────────────────────────────

/**
 * Evaluate whether tabs from a given domain should be grouped.
 *
 * Rules:
 *  - Pinned tabs are excluded (Safety Net).
 *  - Whitelisted domains are excluded.
 *  - Only http/https tabs are considered.
 *  - Once the count of ungrouped same-domain tabs reaches the
 *    configured threshold, they are placed into a named group
 *    with a deterministic color.
 *  - If a group for the domain already exists, new tabs are
 *    moved into it instead of creating a duplicate.
 */
async function evaluateAutoGroup(triggerTab) {
  // Guard: ignore pinned tabs
  if (triggerTab.pinned) return;

  // Guard: need a real URL
  const domain = getRootDomain(triggerTab.url);
  if (!domain) return;

  // Guard: skip whitelisted domains
  if (await isDomainWhitelisted(domain)) return;

  const { config } = await chrome.storage.local.get('config');
  const threshold = config?.groupThreshold ?? DEFAULT_CONFIG.groupThreshold;

  // Query all tabs with the same domain across all windows.
  // Exclude pinned tabs — they are immune to grouping.
  const allTabs = await chrome.tabs.query({ pinned: false });
  const sameDomainTabs = allTabs.filter((t) => getRootDomain(t.url) === domain);

  // Not enough to group yet
  if (sameDomainTabs.length < threshold) return;

  // Check if a group for this domain already exists
  const existingGroup = await findExistingGroup(domain);

  if (existingGroup) {
    // Move any ungrouped same-domain tabs into the existing group
    const ungroupedIds = sameDomainTabs
      .filter((t) => t.groupId === -1 || t.groupId !== existingGroup.id)
      .map((t) => t.id);

    if (ungroupedIds.length > 0) {
      await chrome.tabs.group({ tabIds: ungroupedIds, groupId: existingGroup.id });
    }
  } else {
    // Create a new group from all same-domain tabs
    const tabIds = sameDomainTabs.map((t) => t.id);
    const groupId = await chrome.tabs.group({ tabIds });

    const colorIndex = domainToColorIndex(domain);
    await chrome.tabGroups.update(groupId, {
      title: domain.toUpperCase(),
      color: GROUP_COLORS[colorIndex],
      collapsed: false,
    });

    // Schedule auto-collapse alarm
    scheduleCollapseAlarm(groupId, config?.collapseAfterHours ?? DEFAULT_CONFIG.collapseAfterHours);
  }
}

/**
 * Find an existing tab group whose title matches the UPPERCASED domain.
 * Returns the group object or null.
 */
async function findExistingGroup(domain) {
  const groups = await chrome.tabGroups.query({ title: domain.toUpperCase() });
  return groups.length > 0 ? groups[0] : null;
}

// ─── Auto-Collapse ──────────────────────────────────────────────

const COLLAPSE_ALARM_PREFIX = 'collapse-group-';

/**
 * Create a one-shot alarm that fires after `hours` to collapse the group.
 */
function scheduleCollapseAlarm(groupId, hours) {
  const alarmName = `${COLLAPSE_ALARM_PREFIX}${groupId}`;
  chrome.alarms.create(alarmName, { delayInMinutes: hours * 60 });
}

/**
 * Handle collapse alarms. Collapses the referenced group if it still exists.
 */
async function handleCollapseAlarm(alarmName) {
  const groupIdStr = alarmName.replace(COLLAPSE_ALARM_PREFIX, '');
  const groupId = parseInt(groupIdStr, 10);
  if (isNaN(groupId)) return;

  try {
    await chrome.tabGroups.update(groupId, { collapsed: true });
  } catch {
    // Group may have been closed already — ignore
  }
}

// ─── Event Listeners (registered synchronously at top level) ────

// Storage initialization on install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set(DEFAULT_STORAGE);
  } else if (details.reason === 'update') {
    // Future: schema migration logic
    const data = await chrome.storage.local.get('schema_version');
    if (!data.schema_version) {
      await chrome.storage.local.set(DEFAULT_STORAGE);
    }
  }
});

// Tab created — evaluate grouping for the new tab's domain
chrome.tabs.onCreated.addListener(async (tab) => {
  // New tabs often start with about:blank; wait for a real URL via onUpdated
});

// Tab updated — evaluate once the URL is settled
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when the tab finishes loading (URL is final)
  if (changeInfo.status !== 'complete') return;

  try {
    await evaluateAutoGroup(tab);
  } catch (err) {
    console.error('[Closure] Auto-group error:', err);
  }
});

// Alarm handler — route to the correct feature
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith(COLLAPSE_ALARM_PREFIX)) {
    await handleCollapseAlarm(alarm.name);
    return;
  }
  // Future: Dead End Sweeper, idle-tab check alarms
});

// Message handler for content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Placeholder — feature handlers will be added here
  return false;
});
