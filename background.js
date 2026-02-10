#!/usr/bin/env node
/**
 * Closure — Service Worker (background.js)
 * @version 1.1.0
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

// ─── Dead End Sweeper constants ─────────────────────────────────
const SWEEP_ALARM_NAME = 'dead-end-sweeper';
const SWEEP_INTERVAL_MINUTES = 60;
const BADGE_CLEAR_ALARM = 'clear-sweep-badge';
const STUCK_TAB_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Error patterns matched against tab title for quick detection
 * without needing to inject a content script (handles chrome://
 * error pages and tabs where injection is impossible).
 */
const TITLE_ERROR_PATTERNS = [
  /\b404\b/i,
  /\b500\b/i,
  /\b502\b/i,
  /\b503\b/i,
  /timed?\s*out/i,
  /site\s+can'?t\s+be\s+reached/i,
  /ERR_/i,
  /DNS_PROBE/i,
  /server\s+error/i,
  /page\s+not\s+found/i,
  /this\s+site\s+can'?t\s+be\s+reached/i,
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

// ─── Dead End Sweeper ───────────────────────────────────────────

/**
 * Run a full sweep across all open tabs looking for error pages.
 *
 * Detection strategy (in priority order):
 * 1. Tab title pattern matching (fast, no injection needed)
 * 2. Content script injection for HTTP status + body pattern check
 * 3. Stuck tab detection (status !== 'complete' for > 1 hour)
 *
 * Pinned tabs, audible tabs, and whitelisted domains are always excluded.
 */
async function runDeadEndSweep() {
  if (sweepInProgress) return;
  sweepInProgress = true;

  try {
    const allTabs = await chrome.tabs.query({});
    const sweptTabs = [];

    for (const tab of allTabs) {
      // Safety net: never touch pinned or audible tabs
      if (tab.pinned) continue;
      if (tab.audible) continue;

      const domain = getRootDomain(tab.url);

      // Skip non-http tabs (chrome://, about:, etc.) unless stuck
      if (!domain) {
        // Check if it's a stuck loading tab (no URL for > 1 hour)
        if (await isTabStuck(tab)) {
          await sweepTab(tab, 'Stuck loading (no URL, > 1 hour)');
          sweptTabs.push(tab);
        }
        continue;
      }

      // Skip whitelisted domains
      if (await isDomainWhitelisted(domain)) continue;

      // Attempt error detection
      const errorResult = await detectTabError(tab);
      if (errorResult.isError) {
        await sweepTab(tab, errorResult.reason);
        sweptTabs.push(tab);
      }
    }

    // Update badge if any tabs were swept
    if (sweptTabs.length > 0) {
      updateSweepBadge(sweptTabs.length);
    }
  } catch (err) {
    console.error('[Closure] Dead End Sweep error:', err);
  } finally {
    sweepInProgress = false;
  }
}

/**
 * Detect whether a tab is showing an error page.
 *
 * First tries a fast title-based check, then falls back to
 * injecting the content script for deeper analysis.
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<{ isError: boolean, reason: string }>}
 */
async function detectTabError(tab) {
  // Fast path: check tab title against known error patterns
  const titleResult = checkTitleForErrors(tab.title || '');
  if (titleResult.isError) return titleResult;

  // Check for stuck loading (status !== 'complete' for > 1 hour)
  if (await isTabStuck(tab)) {
    return { isError: true, reason: 'Tab stuck loading for > 1 hour' };
  }

  // Slow path: inject content script for HTTP status + body check
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: contentScriptDetectError,
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch {
    // Injection may fail on restricted pages (chrome://, etc.) — skip
  }

  return { isError: false, reason: '' };
}

/**
 * Check a tab title string against known error patterns.
 * This is the fastest detection method — no injection required.
 *
 * @param {string} title
 * @returns {{ isError: boolean, reason: string }}
 */
function checkTitleForErrors(title) {
  for (const pattern of TITLE_ERROR_PATTERNS) {
    if (pattern.test(title)) {
      const match = title.match(pattern);
      return {
        isError: true,
        reason: `Title match: ${match ? match[0] : pattern.source}`,
      };
    }
  }
  return { isError: false, reason: '' };
}

/**
 * Check whether a tab has been stuck in 'loading' state for too long.
 *
 * Uses a heuristic: if the tab's status is not 'complete' and its
 * lastAccessed time is older than the threshold, it's considered stuck.
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<boolean>}
 */
async function isTabStuck(tab) {
  if (tab.status === 'complete') return false;

  // lastAccessed is available on chrome.tabs.Tab
  const lastAccessed = tab.lastAccessed || Date.now();
  const elapsed = Date.now() - lastAccessed;
  return elapsed > STUCK_TAB_THRESHOLD_MS;
}

/**
 * Inline function injected into the tab via chrome.scripting.executeScript.
 * Runs in the page context — checks HTTP status via Performance API
 * and scans page content for error patterns.
 *
 * Must be self-contained (no references to outer scope).
 */
function contentScriptDetectError() {
  const result = { isError: false, reason: '' };

  // Check HTTP status via Navigation Timing API
  try {
    const navEntries = performance.getEntriesByType('navigation');
    if (navEntries.length > 0) {
      const status = navEntries[0].responseStatus;
      if (status && status >= 400) {
        result.isError = true;
        result.reason = `HTTP ${status}`;
        return result;
      }
    }
  } catch {
    // API may not be available
  }

  // Scan body text for error patterns
  const patterns = [
    /\b404\b/i, /\b500\b/i, /\b502\b/i, /\b503\b/i,
    /timed?\s*out/i, /site\s+can'?t\s+be\s+reached/i,
    /ERR_/i, /DNS_PROBE/i, /server\s+error/i,
    /page\s+not\s+found/i,
  ];

  const text = (document.body?.innerText || '').substring(0, 2000);
  const combined = `${document.title || ''} ${text}`;

  for (const pattern of patterns) {
    if (pattern.test(combined)) {
      const match = combined.match(pattern);
      result.isError = true;
      result.reason = `Content match: ${match ? match[0] : pattern.source}`;
      return result;
    }
  }

  return result;
}

/**
 * Log a swept tab to storage, update stats, then close it.
 * Always writes to storage *before* closing the tab to ensure
 * the record is preserved even if the service worker terminates.
 *
 * @param {chrome.tabs.Tab} tab
 * @param {string} reason
 */
async function sweepTab(tab, reason) {
  try {
    // Read-modify-write: append to swept[] and update stats
    const data = await chrome.storage.local.get(['swept', 'stats']);
    const swept = data.swept || [];
    const stats = data.stats || { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 };

    swept.push({
      url: tab.url || '',
      title: tab.title || 'Untitled',
      timestamp: Date.now(),
      reason,
    });

    stats.tabsTidiedThisWeek += 1;
    stats.ramSavedEstimate += 50; // ~50 MB per tab heuristic

    await chrome.storage.local.set({ swept, stats });

    // Now safe to close the tab
    await chrome.tabs.remove(tab.id);
  } catch (err) {
    // Tab may already be closed — log and move on
    console.error('[Closure] sweepTab error:', err);
  }
}

/**
 * Show "+N" on the extension badge after a sweep, then auto-clear
 * after 30 seconds via an alarm (not setTimeout — MV3 safe).
 *
 * @param {number} count - number of tabs swept
 */
function updateSweepBadge(count) {
  chrome.action.setBadgeText({ text: `+${count}` });
  chrome.action.setBadgeBackgroundColor({ color: '#d4a373' });

  // Schedule badge clear alarm (30 seconds = 0.5 minutes)
  chrome.alarms.create(BADGE_CLEAR_ALARM, { delayInMinutes: 0.5 });
}

// ─── Event Listeners (registered synchronously at top level) ────

// Dead End Sweeper — in-progress guard to prevent concurrent sweeps
let sweepInProgress = false;

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

  // Schedule recurring Dead End Sweeper alarm
  chrome.alarms.create(SWEEP_ALARM_NAME, {
    delayInMinutes: 1,             // first sweep 1 min after install
    periodInMinutes: SWEEP_INTERVAL_MINUTES,
  });
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

  if (alarm.name === SWEEP_ALARM_NAME) {
    await runDeadEndSweep();
    return;
  }

  if (alarm.name === BADGE_CLEAR_ALARM) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  // Future: idle-tab check alarms
});

// Message handler for content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Placeholder — feature handlers will be added here
  return false;
});
