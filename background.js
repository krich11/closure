#!/usr/bin/env node
/**
 * Closure — Service Worker (background.js)
 * @version 1.4.0
 *
 * Manages tab grouping (Clean Slate Automator), error sweeping,
 * archival orchestration, and alarm scheduling.
 * All event listeners registered synchronously at top level
 * so they survive service worker restarts.
 */

const DEFAULT_CONFIG = {
  groupThreshold: 3,
  idleThresholdHours: 24,
  whitelist: [],
  enableThematicClustering: false,
  enableTopicGrouping: false,
  topicGroupingIntervalMinutes: 120,
  topicGroupingOvernightOnly: false,
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

// ─── Graceful Exit constants ────────────────────────────────────
const IDLE_CHECK_ALARM = 'idle-tab-check';
const IDLE_CHECK_INTERVAL_MINUTES = 15;
const SNOOZE_ALARM_PREFIX = 'snooze-';
const STAY_OF_EXECUTION_MINUTES = 10;
const RAM_PER_TAB_MB = 50;
const NUCLEAR_IDLE_HOURS = 4;

// ─── Topic Grouping constants ───────────────────────────────────
const TOPIC_GROUPING_ALARM = 'topic-grouping';
const TOPIC_GROUPING_MIN_TABS = 4;

// ─── Notification-based Stay of Execution ───────────────────────
const STAY_NOTIF_PREFIX = 'closure-stay-';

// Race condition guard: tabs currently being archived
const archivingTabs = new Set();

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
 * Common multi-part TLD suffixes. Used by getRegistrableDomain()
 * to correctly extract eTLD+1 (e.g. "bbc.co.uk" not just "co.uk").
 *
 * Not exhaustive, but covers the vast majority of real-world browsing.
 * Kept inline to avoid external dependencies.
 */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr',
  'co.za', 'org.za', 'net.za', 'gov.za',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.tw', 'org.tw', 'net.tw', 'gov.tw',
  'com.hk', 'org.hk', 'net.hk', 'gov.hk',
  'com.sg', 'org.sg', 'net.sg', 'gov.sg',
  'co.il', 'org.il', 'net.il', 'ac.il',
  'com.ar', 'org.ar', 'net.ar', 'gov.ar',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr',
  'co.id', 'or.id', 'go.id', 'web.id',
  'co.th', 'or.th', 'go.th', 'in.th',
  'com.ph', 'org.ph', 'net.ph', 'gov.ph',
  'com.my', 'org.my', 'net.my', 'gov.my',
  'com.pk', 'org.pk', 'net.pk', 'gov.pk',
  'com.ng', 'org.ng', 'gov.ng',
  'com.eg', 'org.eg', 'gov.eg',
  'co.ke', 'or.ke', 'go.ke',
  'com.ua', 'org.ua', 'net.ua',
  'com.pl', 'org.pl', 'net.pl',
  'com.es', 'org.es', 'nom.es',
  'com.pt', 'org.pt', 'net.pt',
  'co.it',
]);

/**
 * Extract the registrable domain (eTLD+1) from a hostname.
 * Groups all subdomains under the same root.
 *
 * Examples:
 *   "docs.google.com"  → "google.com"
 *   "en.wikipedia.org" → "wikipedia.org"
 *   "www.bbc.co.uk"    → "bbc.co.uk"
 *   "github.com"       → "github.com"
 *
 * @param {string} hostname — e.g. "mail.google.com"
 * @returns {string} registrable domain
 */
function getRegistrableDomain(hostname) {
  const host = hostname.replace(/^www\./, '');
  const parts = host.split('.');

  if (parts.length <= 2) return host;

  // Check if the last two segments form a known multi-part TLD
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    // eTLD is two parts, so registrable domain is last three segments
    return parts.length >= 3 ? parts.slice(-3).join('.') : host;
  }

  // Standard TLD — registrable domain is last two segments
  return parts.slice(-2).join('.');
}

/**
 * Extract a grouping-friendly domain from a URL.
 * Returns the registrable domain (eTLD+1) so that subdomains like
 * docs.google.com and mail.google.com group together.
 * Returns null for chrome://, about:, and other non-http(s) URLs.
 */
function getRootDomain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return getRegistrableDomain(parsed.hostname);
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
      collapsed: true,
    });
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

// ─── Topic Grouping (AI-powered content clustering) ────────────

/**
 * Run AI-powered topic grouping on ungrouped tabs.
 *
 * Only processes tabs that aren’t already in a group (groupId === -1),
 * so domain grouping always takes priority. Extracts page content,
 * sends it to on-device AI, and creates collapsed topic groups.
 *
 * Skips silently when:
 *  - Feature is disabled in config
 *  - Fewer than 4 ungrouped tabs exist
 *  - AI is unavailable
 *
 * When “overnight only” is enabled, the alarm itself is scheduled at
 * 2 AM daily, so no runtime hour check is needed here.
 */
async function runTopicGrouping({ manual = false } = {}) {
  console.debug(`[Closure:TopicGroup] Starting topic grouping run... (manual: ${manual})`);
  const { config } = await chrome.storage.local.get('config');
  if (!manual && !config?.enableTopicGrouping) {
    console.debug('[Closure:TopicGroup] Skipped — feature disabled in config');
    return;
  }

  // Gather ungrouped, non-pinned, non-audible, non-whitelisted http(s) tabs
  const allTabs = await chrome.tabs.query({ pinned: false });
  console.debug(`[Closure:TopicGroup] Found ${allTabs.length} non-pinned tabs`);
  const candidates = [];
  for (const tab of allTabs) {
    if (tab.groupId !== -1) continue;   // already grouped
    if (tab.audible) continue;           // audible immunity
    const domain = getRootDomain(tab.url);
    if (!domain) continue;               // non-http
    if (await isDomainWhitelisted(domain)) continue;
    candidates.push(tab);
  }

  console.debug(`[Closure:TopicGroup] ${candidates.length} candidate tabs after filtering (need >= ${TOPIC_GROUPING_MIN_TABS})`);
  candidates.forEach((t, i) => console.debug(`  [${i}] ${t.title?.substring(0, 60)} — ${t.url?.substring(0, 80)}`));

  if (candidates.length < TOPIC_GROUPING_MIN_TABS) {
    console.debug('[Closure:TopicGroup] Not enough candidates, aborting');
    return;
  }

  // Build the AI prompt from tab titles and URLs (no injection needed)
  const summaries = candidates
    .map((t, i) => `[${i}] ${t.title || 'Untitled'}\n${t.url}`)
    .join('\n\n');

  const prompt = `You are a tab organizer. Group these browser tabs by topic. Only create a cluster if 2 or more tabs share a clear theme. Leave unrelated tabs unclustered. Return ONLY valid JSON, no markdown:\n{"clusters":[{"title":"Short Topic Name","indices":[0,1]}]}\n\n${summaries}`;

  console.debug('[Closure:TopicGroup] AI prompt built, sending to offscreen document...');
  console.debug('[Closure:TopicGroup] Prompt length:', prompt.length, 'chars');

  // Run AI through offscreen document (no host permissions needed)
  let clusters;
  try {
    const response = await promptAi(prompt);
    if (!response) {
      console.debug('[Closure:TopicGroup] AI returned no response');
      return;
    }
    // Parse JSON from response (AI may wrap in markdown code fences)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.debug('[Closure:TopicGroup] No JSON found in AI response');
      return;
    }
    clusters = JSON.parse(jsonMatch[0]);
    console.debug('[Closure:TopicGroup] AI response:', JSON.stringify(clusters));
  } catch (err) {
    console.debug('[Closure:TopicGroup] AI call failed:', err?.message || err);
    return;
  }

  if (!clusters?.clusters || !Array.isArray(clusters.clusters)) {
    console.debug('[Closure:TopicGroup] Invalid cluster structure, aborting');
    return;
  }

  console.debug(`[Closure:TopicGroup] AI returned ${clusters.clusters.length} cluster(s)`);

  // Create tab groups from AI clusters
  for (const cluster of clusters.clusters) {
    if (!cluster.title || !Array.isArray(cluster.indices)) {
      console.debug(`[Closure:TopicGroup] Skipping malformed cluster:`, cluster);
      continue;
    }
    if (cluster.indices.length < 2) {
      console.debug(`[Closure:TopicGroup] Skipping "${cluster.title}" — only ${cluster.indices.length} tab(s)`);
      continue;
    }

    console.debug(`[Closure:TopicGroup] Processing cluster "${cluster.title}" with indices [${cluster.indices}]`);

    // Map indices to tab IDs, skipping invalid indices
    const tabIds = cluster.indices
      .filter((i) => i >= 0 && i < candidates.length)
      .map((i) => candidates[i].id);

    if (tabIds.length < 2) {
      console.debug(`[Closure:TopicGroup] Not enough valid tab IDs for "${cluster.title}", skipping`);
      continue;
    }

    // Verify tabs still exist and are ungrouped
    const validIds = [];
    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        if (t.groupId === -1) validIds.push(id);
      } catch {
        console.debug(`[Closure:TopicGroup] Tab ${id} no longer exists`);
      }
    }

    if (validIds.length < 2) {
      console.debug(`[Closure:TopicGroup] Not enough ungrouped tabs for "${cluster.title}" after verification`);
      continue;
    }

    try {
      const groupId = await chrome.tabs.group({ tabIds: validIds });
      const colorIndex = domainToColorIndex(cluster.title.toLowerCase());
      await chrome.tabGroups.update(groupId, {
        title: cluster.title.toUpperCase(),
        color: GROUP_COLORS[colorIndex],
        collapsed: true,
      });
      console.debug(`[Closure:TopicGroup] Created group "${cluster.title.toUpperCase()}" with ${validIds.length} tabs (color: ${GROUP_COLORS[colorIndex]})`);
    } catch (err) {
      console.error('[Closure:TopicGroup] Group creation error:', err);
    }
  }

  console.debug('[Closure:TopicGroup] Run complete');
}

// ─── Offscreen AI Helpers ───────────────────────────────────────

/**
 * Ensure the offscreen document exists. Chrome only allows one
 * offscreen document per extension at a time.
 */
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('offscreen/offscreen.html'),
    reasons: ['DOM_PARSER'],
    justification: 'Run on-device AI (LanguageModel) for tab summarization and topic clustering',
  });
}

/**
 * Send a prompt to the on-device AI via the offscreen document.
 * Returns the raw text response, or null if AI is unavailable.
 *
 * @param {string} prompt
 * @returns {Promise<string|null>}
 */
async function promptAi(prompt) {
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      action: 'aiPrompt',
      prompt,
    });
    if (response?.ok) return response.result;
    console.debug('[Closure:AI] Offscreen returned error:', response?.error);
    return null;
  } catch (err) {
    console.debug('[Closure:AI] promptAi failed:', err?.message || err);
    return null;
  }
}

/**
 * Schedule or update the topic grouping alarm based on config.
 * Called on install, config change, or feature toggle.
 */
async function scheduleTopicGroupingAlarm() {
  const { config } = await chrome.storage.local.get('config');
  if (!config?.enableTopicGrouping) {
    chrome.alarms.clear(TOPIC_GROUPING_ALARM);
    return;
  }

  if (config.topicGroupingOvernightOnly) {
    // Schedule a single daily alarm at 2 AM local time
    const now = new Date();
    const next2am = new Date(now);
    next2am.setHours(2, 0, 0, 0);
    // If it's already past 2 AM today, schedule for tomorrow
    if (now >= next2am) {
      next2am.setDate(next2am.getDate() + 1);
    }
    const delayMs = next2am.getTime() - now.getTime();
    chrome.alarms.create(TOPIC_GROUPING_ALARM, {
      delayInMinutes: delayMs / 60000,
      periodInMinutes: 1440, // repeat every 24 hours
    });
  } else {
    const interval = config.topicGroupingIntervalMinutes ?? DEFAULT_CONFIG.topicGroupingIntervalMinutes;
    chrome.alarms.create(TOPIC_GROUPING_ALARM, {
      delayInMinutes: 3,
      periodInMinutes: interval,
    });
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
 * Uses title-based pattern matching and stuck-tab heuristics.
 * No content script injection — works without host_permissions.
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<{ isError: boolean, reason: string }>}
 */
async function detectTabError(tab) {
  // Check tab title against known error patterns
  const titleResult = checkTitleForErrors(tab.title || '');
  if (titleResult.isError) return titleResult;

  // Check for stuck loading (status !== 'complete' for > 1 hour)
  if (await isTabStuck(tab)) {
    return { isError: true, reason: 'Tab stuck loading for > 1 hour' };
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

// contentScriptDetectError removed — detection now uses title patterns + stuck heuristic only

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

// ─── Graceful Exit (Archival) ───────────────────────────────────

/**
 * Scan all tabs and identify those idle beyond the configured threshold.
 * Processes them sequentially to avoid storage write races.
 */
async function runIdleTabCheck() {
  const { config } = await chrome.storage.local.get('config');
  const thresholdHours = config?.idleThresholdHours ?? DEFAULT_CONFIG.idleThresholdHours;
  const thresholdMs = thresholdHours * 60 * 60 * 1000;

  const allTabs = await chrome.tabs.query({});
  const now = Date.now();

  for (const tab of allTabs) {
    // Safety net: never archive pinned or audible tabs
    if (tab.pinned) continue;
    if (tab.audible) continue;

    // Skip tabs already being processed
    if (archivingTabs.has(tab.id)) continue;

    // Skip non-http tabs
    const domain = getRootDomain(tab.url);
    if (!domain) continue;

    // Skip whitelisted domains
    if (await isDomainWhitelisted(domain)) continue;

    // Skip snoozed tabs
    if (await isTabSnoozed(tab.id)) continue;

    // Check idle duration
    const lastAccessed = tab.lastAccessed || now;
    const idleMs = now - lastAccessed;
    if (idleMs < thresholdMs) continue;

    // Archive this tab
    archivingTabs.add(tab.id);
    try {
      await archiveTab(tab);
    } catch (err) {
      console.error('[Closure] Archive error for tab', tab.id, err);
    } finally {
      archivingTabs.delete(tab.id);
    }
  }
}

/**
 * Check whether a tab has an active snooze alarm.
 * Snooze alarms are named "snooze-{tabId}".
 *
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isTabSnoozed(tabId) {
  const alarm = await chrome.alarms.get(`${SNOOZE_ALARM_PREFIX}${tabId}`);
  return !!alarm;
}

/**
 * Attempt AI summarization of a tab using title + URL via the offscreen document.
 * If AI is unavailable, returns a fallback summary from tab metadata.
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<{ summary: string, summaryType: 'ai'|'fallback' }>}
 */
async function summarizeTab(tab) {
  const title = tab.title || 'Untitled';
  const url = tab.url || '';

  const prompt = `Summarize this page in 3 bullet points (total under 100 words), preserving key facts, numbers, dates, action items, and the user's likely intent for visiting.\n\nTitle: ${title}\nURL: ${url}`;

  const aiResult = await promptAi(prompt);
  if (aiResult) {
    return { summary: aiResult, summaryType: 'ai' };
  }

  // Fallback: use title + URL
  return { summary: title, summaryType: 'fallback' };
}

/**
 * Archive a single tab: summarize via AI (offscreen), persist to storage,
 * then close the tab and send a notification.
 *
 * Critical ordering: save to storage BEFORE closing the tab to survive
 * service worker termination.
 *
 * @param {chrome.tabs.Tab} tab
 */
async function archiveTab(tab) {
  // Verify the tab still exists
  try {
    await chrome.tabs.get(tab.id);
  } catch {
    return; // Tab was closed by user — nothing to do
  }

  const domain = getRootDomain(tab.url) || 'unknown';
  const title = tab.title || 'Untitled';

  // Attempt AI summarization via offscreen document
  const { summary, summaryType } = await summarizeTab(tab);

  // Persist to storage BEFORE closing (survives worker death)
  const data = await chrome.storage.local.get(['archived', 'stats']);
  const archived = data.archived || [];
  const stats = data.stats || { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 };

  archived.push({
    url: tab.url || '',
    title,
    favicon: tab.favIconUrl || '',
    timestamp: Date.now(),
    summary,
    summaryType,
    domain,
  });

  stats.tabsTidiedThisWeek += 1;
  stats.ramSavedEstimate += RAM_PER_TAB_MB;

  await chrome.storage.local.set({ archived, stats });

  // Now close the tab
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    // Tab may have been closed between save and remove — that's fine
  }

  // Send notification
  sendArchivalNotification(title);
}

/**
 * Send a notification when a tab is archived.
 *
 * @param {string} pageTitle
 */
function sendArchivalNotification(pageTitle) {
  const truncated = pageTitle.length > 50
    ? pageTitle.substring(0, 47) + '...'
    : pageTitle;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Tab Archived',
    message: `Moved "${truncated}" to your Sunday Digest. Summary saved.`,
    priority: 0,
  });
}

/**
 * Nuclear archive: close all tabs idle > 4 hours.
 * Used by the popup's "Archive Idle Tabs Now" button.
 * Returns the count of archived tabs for toast display.
 *
 * @returns {Promise<number>} count of archived tabs
 */
async function handleNuclearArchive() {
  const thresholdMs = NUCLEAR_IDLE_HOURS * 60 * 60 * 1000;
  const allTabs = await chrome.tabs.query({});
  const now = Date.now();
  let archivedCount = 0;

  for (const tab of allTabs) {
    if (tab.pinned) continue;
    if (tab.audible) continue;
    if (archivingTabs.has(tab.id)) continue;

    const domain = getRootDomain(tab.url);
    if (!domain) continue;
    if (await isDomainWhitelisted(domain)) continue;
    if (await isTabSnoozed(tab.id)) continue;

    const lastAccessed = tab.lastAccessed || now;
    if (now - lastAccessed < thresholdMs) continue;

    archivingTabs.add(tab.id);
    try {
      await archiveTab(tab);
      archivedCount++;
    } catch (err) {
      console.error('[Closure] Nuclear archive error:', err);
    } finally {
      archivingTabs.delete(tab.id);
    }
  }

  // Post-nuclear badge
  if (archivedCount > 0) {
    updateSweepBadge(archivedCount);
  }

  return archivedCount;
}

/**
 * Show a "Stay of Execution" notification for a tab about to be archived.
 * Uses chrome.notifications with action buttons instead of content script
 * injection — works without host_permissions.
 *
 * Notification ID encodes the tabId so the onButtonClicked handler can
 * route the decision back to the correct tab.
 *
 * @param {number} tabId
 */
async function showStayOfExecution(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const truncatedTitle = (tab.title || 'Untitled').substring(0, 40);

    chrome.notifications.create(`${STAY_NOTIF_PREFIX}${tabId}`, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Tab About to Be Archived',
      message: `"${truncatedTitle}" has been idle. Keep it open?`,
      buttons: [
        { title: 'Yes, Keep Open' },
        { title: 'Snooze 24h' },
      ],
      requireInteraction: true,
      priority: 2,
    });
  } catch {
    // Tab may have been closed or notification creation failed — skip
  }
}

// ─── Event Listeners (registered synchronously at top level) ────

// Dead End Sweeper — in-progress guard to prevent concurrent sweeps
let sweepInProgress = false;

// Storage initialization on install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set(DEFAULT_STORAGE);

    // Open the onboarding page on first install
    chrome.tabs.create({
      url: chrome.runtime.getURL('onboarding/onboarding.html'),
      active: true,
    });
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

  // Schedule recurring idle tab check
  chrome.alarms.create(IDLE_CHECK_ALARM, {
    delayInMinutes: 2,
    periodInMinutes: IDLE_CHECK_INTERVAL_MINUTES,
  });

  // Schedule topic grouping if enabled
  await scheduleTopicGroupingAlarm();
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
    // If this tab is inside a group but its domain no longer matches
    // the group (e.g. user clicked a cross-domain link that opened a
    // new tab inheriting the opener's group), ungroup it first so it
    // can be evaluated for the correct group.
    if (tab.groupId !== -1 && !tab.pinned) {
      const domain = getRootDomain(tab.url);
      if (domain) {
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          const groupDomain = group.title?.toLowerCase();
          if (groupDomain && groupDomain !== domain) {
            await chrome.tabs.ungroup(tabId);
            // Re-fetch tab after ungrouping so evaluateAutoGroup sees the updated state
            tab = await chrome.tabs.get(tabId);
          }
        } catch {
          // Group may have been removed — that's fine
        }
      }
    }

    await evaluateAutoGroup(tab);
  } catch (err) {
    console.error('[Closure] Auto-group error:', err);
  }
});

// Alarm handler — route to the correct feature
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SWEEP_ALARM_NAME) {
    await runDeadEndSweep();
    return;
  }

  if (alarm.name === BADGE_CLEAR_ALARM) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  if (alarm.name === IDLE_CHECK_ALARM) {
    await runIdleTabCheck();
    return;
  }

  if (alarm.name === TOPIC_GROUPING_ALARM) {
    await runTopicGrouping();
    return;
  }

  // Snooze alarm expired — tab is eligible for archival again
  if (alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
    // No action needed; the snooze alarm simply expires
    // and isTabSnoozed() will return false on next check
    return;
  }
});

// Notification button handler — Stay of Execution responses
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  if (!notifId.startsWith(STAY_NOTIF_PREFIX)) return;

  const tabId = parseInt(notifId.substring(STAY_NOTIF_PREFIX.length), 10);
  if (isNaN(tabId)) return;

  if (buttonIndex === 0) {
    // "Yes, Keep Open" — remove from archiving set
    archivingTabs.delete(tabId);
  } else if (buttonIndex === 1) {
    // "Snooze 24h" — remove from archiving set + set snooze alarm
    archivingTabs.delete(tabId);
    chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${tabId}`, {
      delayInMinutes: 24 * 60,
    });
  }

  // Dismiss the notification
  chrome.notifications.clear(notifId);
});

// Auto-dismiss stay-of-execution notifications when closed without clicking buttons
chrome.notifications.onClosed.addListener((notifId, byUser) => {
  // If user dismissed without choosing → tab proceeds to archival (no action needed)
});

// Message handler for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages from the offscreen document (they're handled by sendMessage callback)
  if (message.action === 'aiPrompt') return false;

  if (message.action === 'nuclearArchive') {
    handleNuclearArchive().then((count) => {
      sendResponse({ count });
    });
    return true; // async sendResponse
  }

  if (message.action === 'runTopicGrouping') {
    runTopicGrouping({ manual: true }).then(() => {
      sendResponse({ ok: true });
    }).catch((err) => {
      console.error('[Closure:TopicGroup] Manual trigger error:', err);
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.action === 'rescheduleTopicGrouping') {
    scheduleTopicGroupingAlarm().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
