#!/usr/bin/env node
/**
 * Closure — Memory Lane (digest.js)
 * @version 1.8.1
 *
 * Renders the weekly archival dashboard.
 * - Restores tabs/groups
 * - Displays local stats
 * - Handles simple client-side sorting/filtering (no extra network calls)
 */

document.addEventListener('DOMContentLoaded', async () => {
  renderDate();
  await loadSortPreference();
  await loadAndRenderContent();
  setupSortControl();
  setupSearchFilter();
  setupExportButtons();
  setupActionButtons();
});

// Update the masthead date to today or "Sunday, Month Day"
function renderDate() {
  const dateEl = document.getElementById('digest-date');
  if (dateEl) {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('en-US', options);
  }
}

/**
 * Load the user's saved sort preference from config.
 * Falls back to 'recency' if not set.
 */
async function loadSortPreference() {
  const { config } = await chrome.storage.local.get('config');
  const sortBy = config?.archiveSortBy || 'recency';
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.value = sortBy;
  }
}

async function loadAndRenderContent() {
  const { archived, swept, stats, config } = await chrome.storage.local.get(['archived', 'swept', 'stats', 'config']);

  // Check if debug tools are enabled (controls re-summarize button visibility)
  createCard._debugEnabled = config?.enableDebugTools ?? false;

  // Render Stats — use actual array lengths, not running counters
  const archivedList = archived || [];
  const sweptList = swept || [];
  document.getElementById('total-archived').textContent = archivedList.length;
  document.getElementById('total-swept').textContent = sweptList.length;
  
  const savedMb = stats?.ramSavedEstimate || 0;
  document.getElementById('ram-saved').textContent = savedMb >= 1024 
    ? `${(savedMb/1024).toFixed(1)} GB` 
    : `${Math.round(savedMb)} MB`;

  // Topics Explored — show placeholder while AI processes
  // Immediate fallback: unique domain count (replaced by AI if available)
  const domains = new Set(archivedList.map(item => item.domain));
  const domainCount = domains.size;
  document.getElementById('topics-explored').textContent = domainCount || '\u2014';
  document.getElementById('footer-topics-count').textContent = domainCount;

  // Kick off AI topic extraction asynchronously (non-blocking)
  extractTopicsWithAi(archivedList);

  // Merge archived and swept into a unified feed
  // Tag each item with its source type so createCard can differentiate
  const allItems = [
    ...archivedList.map(item => ({ ...item, _type: 'archived' })),
    ...sweptList.map(item => ({
      ...item,
      _type: 'swept',
      domain: domainFromUrl(item.url),
    })),
  ];

  // Render Feed
  const feedEl = document.getElementById('archive-feed');
  if (allItems.length === 0) {
    return; // Leave empty state visible
  }

  // Clear empty state
  feedEl.innerHTML = '';
  
  // Group by Domain (default)
  const sortMode = document.getElementById('sort-select')?.value || 'recency';
  const groups = groupBy(allItems, 'domain');
  
  // Sort domains: by most recent entry timestamp (recency) or alphabetically
  const sortedDomains = Object.keys(groups).sort((a, b) => {
    if (sortMode === 'recency') {
      const latestA = Math.max(...groups[a].map(i => i.timestamp || 0));
      const latestB = Math.max(...groups[b].map(i => i.timestamp || 0));
      return latestB - latestA; // newest first
    }
    return a.localeCompare(b);
  });

  sortedDomains.forEach(domain => {
    const items = groups[domain];
    // Sort items within group by recency (newest first)
    items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    // Create Group Section
    const groupSection = document.createElement('section');
    groupSection.className = 'archive-group';
    
    // Header
    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <h3 class="group-title">${domain ? domain.toUpperCase() : 'UNKNOWN'}</h3>
      <div class="group-actions">
        <button class="restore-group-btn" data-domain="${domain}">Restore Group</button>
      </div>
    `;
    groupSection.appendChild(header);

    // Cards Grid
    const grid = document.createElement('div');
    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
    grid.style.gap = 'var(--space-md)';

    items.forEach(item => {
      const card = createCard(item);
      grid.appendChild(card);
    });

    groupSection.appendChild(grid);
    feedEl.appendChild(groupSection);
  });

  setupEventListeners();
}

/**
 * Extract a display domain from a URL (for swept items that lack a domain field).
 */
function domainFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Return IP addresses as-is
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;
    const parts = hostname.split('.');
    return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
  } catch {
    return 'unknown';
  }
}

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'archive-card';
  const isSwept = item._type === 'swept';
  if (isSwept) card.classList.add('archive-card--swept');
  
  // Safe Fallbacks
  const title = item.title || 'Untitled Page';
  const safeTitle = title.replace(/"/g, '&quot;');
  const url = item.url || '#';
  const archiveDate = new Date(item.timestamp);
  const displayDate = archiveDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const displayTime = archiveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Summary — only for archived tabs with AI summaries
  let summaryHtml = '';
  if (!isSwept && item.summary && item.summaryType === 'ai') {
    summaryHtml = `<div class="card-summary">${formatSummary(item.summary)}</div>`;
  }

  // Re-summarize button — only visible when debug tools are enabled
  // Uses timestamp as unique key since multiple entries can share the same URL
  const showDebug = createCard._debugEnabled;
  const resummarizeHtml = (!isSwept && showDebug)
    ? `<button class="resummarize-btn" data-url="${url}" data-title="${safeTitle}" data-ts="${item.timestamp}">Re-summarize</button>`
    : '';

  // Type badge — swept tabs show the reason
  const typeBadge = isSwept
    ? `<span class="card-badge card-badge--swept" title="${item.reason || 'Error detected'}">Swept</span>`
    : '';
  
  card.innerHTML = `
    <img src="${item.favicon || '../icons/icon-48.png'}" alt="" class="card-favicon">
    <div class="card-content">
      <h4 class="card-title">
        <a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        ${typeBadge}
      </h4>
      ${summaryHtml}
    </div>
    <div class="card-footer">
      <span class="card-timestamp">${displayDate}, ${displayTime}</span>
      ${resummarizeHtml}
      <button class="restore-btn" data-url="${url}">Restore</button>
    </div>
  `;

  // Favicon fallback — can't use inline onerror (CSP violation in MV3)
  const img = card.querySelector('.card-favicon');
  img.addEventListener('error', () => { img.src = '../icons/icon-48.png'; }, { once: true });

  return card;
}

function formatSummary(text) {
  // Strip any bullet markers or line breaks — display as a single inline phrase
  const clean = text.replace(/^[-•*]\s*/gm, '').replace(/\n+/g, ' ').trim();
  return `<p>${clean}</p>`;
}

/**
 * Handle a single re-summarize click independently.
 * Runs as a detached async function so multiple clicks execute concurrently.
 *
 * @param {HTMLButtonElement} btn
 */
async function handleResummarize(btn) {
  const url = btn.dataset.url;
  const title = btn.dataset.title;
  const ts = parseInt(btn.dataset.ts, 10);
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const response = await chrome.runtime.sendMessage({ action: 'resummarize', url, title });
    if (response?.ok) {
      // Update the card's summary display
      const cardContent = btn.closest('.archive-card')?.querySelector('.card-content');
      if (cardContent) {
        let summaryEl = cardContent.querySelector('.card-summary');
        if (!summaryEl) {
          summaryEl = document.createElement('div');
          summaryEl.className = 'card-summary';
          cardContent.appendChild(summaryEl);
        }
        summaryEl.innerHTML = formatSummary(response.summary);
      }
      // Persist to storage — match by timestamp (unique per entry)
      const { archived } = await chrome.storage.local.get('archived');
      const entry = archived?.find(a => a.timestamp === ts);
      if (entry) {
        entry.summary = response.summary;
        entry.summaryType = 'ai';
        await chrome.storage.local.set({ archived });
      }
      btn.textContent = 'Done';
    } else {
      btn.textContent = 'No AI';
    }
  } catch (err) {
    btn.textContent = 'Error';
    console.error('[Closure] Re-summarize error:', err);
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Re-summarize';
  }, 3000);
}

async function setupEventListeners() {
  // Delegate event listeners for restore buttons
  document.getElementById('archive-feed').addEventListener('click', async (e) => {
    if (e.target.classList.contains('restore-btn')) {
      const url = e.target.dataset.url;
      if (url) {
        await chrome.tabs.create({ url, active: false });
        e.target.textContent = 'Restored';
        e.target.disabled = true;
      }
    } else if (e.target.classList.contains('restore-group-btn')) {
      const domain = e.target.dataset.domain;
      // In a real app we would gather urls from DOM or re-query storage.
      // Re-querying storage is safer.
      if (domain) {
        const { archived } = await chrome.storage.local.get('archived');
        const urlsToRestore = archived.filter(i => i.domain === domain).map(i => i.url);
        
        // Open them
        for (const u of urlsToRestore) {
          await chrome.tabs.create({ url: u, active: false });
        }
        
        e.target.textContent = 'All Restored';
        e.target.disabled = true;
      }
    } else if (e.target.classList.contains('resummarize-btn')) {
      // Fire-and-forget: each re-summarize runs independently so
      // multiple buttons can be clicked concurrently
      handleResummarize(e.target);
    }
  });

  // Enable the Theme sort option when AI is available
  const themeOption = document.getElementById('sort-theme-option');
  const aiHint = document.getElementById('ai-hint');
  const aiHintLink = document.getElementById('ai-hint-link');
  if (themeOption) {
    const aiReady = await isAiAvailable();
    if (aiReady) {
      themeOption.disabled = false;
      if (aiHint) aiHint.hidden = true;
    } else {
      if (aiHint) aiHint.hidden = false;
      if (aiHintLink) {
        aiHintLink.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
        });
      }
    }
  }
}

/**
 * Re-sort the archive feed when the sort control changes.
 * Persists the preference to config so it's remembered across sessions.
 */
function setupSortControl() {
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', async () => {
      const value = sortSelect.value;

      if (value === 'theme') {
        // Show loading state in the dropdown
        const themeOption = document.getElementById('sort-theme-option');
        const origText = themeOption?.textContent;
        if (themeOption) themeOption.textContent = '\u2728 Clustering\u2026';
        sortSelect.disabled = true;

        try {
          await clusterByTheme();
        } catch (err) {
          console.error('[Closure] Clustering error:', err);
          // Fall back to recency on failure
          sortSelect.value = 'recency';
          await loadAndRenderContent();
        } finally {
          if (themeOption) themeOption.textContent = origText;
          sortSelect.disabled = false;
        }
        return;
      }

      // Persist sort preference (only for non-AI sorts)
      const { config } = await chrome.storage.local.get('config');
      if (config) {
        config.archiveSortBy = value;
        await chrome.storage.local.set({ config });
      }
      await loadAndRenderContent();
    });
  }
}

/**
 * Check if on-device AI is available (new LanguageModel global or legacy window.ai).
 */
async function isAiAvailable() {
  try {
    if (typeof LanguageModel !== 'undefined') {
      const availability = await LanguageModel.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      return availability !== 'unavailable';
    }
    if (typeof window.ai !== 'undefined' && window.ai?.languageModel) {
      const capabilities = await window.ai.languageModel.capabilities();
      return capabilities.available === 'readily';
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Create an AI language model session (new API or legacy fallback).
 */
async function createAiSession() {
  if (typeof LanguageModel !== 'undefined') {
    return await LanguageModel.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
  }
  if (typeof window.ai !== 'undefined' && window.ai?.languageModel) {
    return await window.ai.languageModel.create();
  }
  throw new Error('AI not available');
}

/**
 * Use on-device AI to identify distinct topics from archived tab summaries/titles.
 * Caches the result keyed by a hash of the archived URLs+timestamps so it doesn't
 * re-prompt on every page load. Falls back to domain count with a visual indicator.
 *
 * @param {Array} archivedList — the full archived[] array from storage
 */
async function extractTopicsWithAi(archivedList) {
  const topicsEl = document.getElementById('topics-explored');
  const badgeEl = document.getElementById('topics-badge');
  const listEl = document.getElementById('topic-list');
  const footerEl = document.getElementById('footer-topics-count');
  const footerNoteEl = document.getElementById('footer-ai-note');
  const cardEl = document.getElementById('topics-card');

  if (!archivedList || archivedList.length === 0) {
    topicsEl.textContent = '\u2014';
    if (badgeEl) badgeEl.hidden = true;
    return;
  }

  // Build a cache key from a simple hash of archived URLs + timestamps
  const cacheSignature = archivedList.map(a => `${a.url}|${a.timestamp}`).join('\n');
  const cacheKey = simpleHash(cacheSignature);

  // Check cache first
  const { topicCache } = await chrome.storage.local.get('topicCache');
  if (topicCache && topicCache.key === cacheKey && topicCache.topics) {
    renderTopics(topicCache.topics, topicCache.source);
    return;
  }

  // Check AI availability
  const aiReady = await isAiAvailable();
  if (!aiReady) {
    // Fallback: use unique domains as "topics"
    const domainTopics = [...new Set(archivedList.map(a => a.domain).filter(Boolean))];
    const fallbackResult = { topics: domainTopics, source: 'domains' };
    await chrome.storage.local.set({ topicCache: { key: cacheKey, ...fallbackResult } });
    renderTopics(domainTopics, 'domains');
    return;
  }

  // Show loading state
  topicsEl.textContent = '…';
  if (badgeEl) {
    badgeEl.textContent = 'analyzing';
    badgeEl.hidden = false;
    badgeEl.className = 'stat-badge stat-badge--pending';
  }

  try {
    // Build compact input — title + summary (or first 80 chars of URL) for each entry
    const entries = archivedList.map(a => {
      const desc = a.summary || a.url.substring(0, 80);
      return `- ${a.title}: ${desc}`;
    }).join('\n');

    const session = await createAiSession();
    const prompt = `Analyze these archived browser tabs and identify the distinct topics or themes the user was researching. Return ONLY a JSON array of short topic labels (2-4 words each, max 12 topics). Example: ["Machine Learning", "Travel Planning", "JavaScript Testing"]\n\nTabs:\n${entries}`;

    const result = await session.prompt(prompt);
    session.destroy();

    // Parse the JSON array from the response
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');

    const topics = JSON.parse(jsonMatch[0])
      .filter(t => typeof t === 'string' && t.trim().length > 0)
      .map(t => t.trim())
      .slice(0, 12);

    if (topics.length === 0) throw new Error('Empty topics');

    // Cache the result
    await chrome.storage.local.set({ topicCache: { key: cacheKey, topics, source: 'ai' } });
    renderTopics(topics, 'ai');
  } catch (err) {
    console.warn('[Closure] AI topic extraction failed, using domain fallback:', err);
    const domainTopics = [...new Set(archivedList.map(a => a.domain).filter(Boolean))];
    await chrome.storage.local.set({ topicCache: { key: cacheKey, topics: domainTopics, source: 'domains' } });
    renderTopics(domainTopics, 'domains');
  }

  /**
   * Update the stat card, topic list, and footer with extracted topics.
   */
  function renderTopics(topics, source) {
    const count = topics.length;
    topicsEl.textContent = count;
    footerEl.textContent = count;

    // Badge indicates whether this is AI-derived or domain-based
    if (badgeEl) {
      if (source === 'ai') {
        badgeEl.textContent = 'AI';
        badgeEl.className = 'stat-badge stat-badge--ai';
        badgeEl.title = 'Topics identified by on-device AI';
      } else {
        badgeEl.textContent = 'sites';
        badgeEl.className = 'stat-badge stat-badge--fallback';
        badgeEl.title = 'Unique sites (enable AI for real topic detection)';
      }
      badgeEl.hidden = false;
    }

    // Footer note
    if (footerNoteEl) {
      footerNoteEl.textContent = source === 'ai'
        ? '— identified by on-device AI'
        : '— unique sites visited';
    }

    // Populate the clickable topic list
    if (listEl) {
      listEl.innerHTML = '';
      topics.forEach(topic => {
        const li = document.createElement('li');
        li.textContent = topic;
        listEl.appendChild(li);
      });
      listEl.hidden = true; // collapsed by default
    }

    // Make the card clickable to toggle topic list
    if (cardEl && listEl && topics.length > 0) {
      cardEl.style.cursor = 'pointer';
      cardEl.setAttribute('role', 'button');
      cardEl.setAttribute('aria-expanded', 'false');
      cardEl.setAttribute('aria-label', `${count} topics explored. Click to see list.`);
      // Remove old listener if re-rendering
      cardEl.removeEventListener('click', toggleTopicList);
      cardEl.addEventListener('click', toggleTopicList);
    }
  }
}

/** Toggle visibility of the topic list under the stat card. */
function toggleTopicList(e) {
  // Don't toggle if clicking a button inside the card
  if (e.target.closest('button')) return;
  const listEl = document.getElementById('topic-list');
  const cardEl = document.getElementById('topics-card');
  if (!listEl) return;
  const show = listEl.hidden;
  listEl.hidden = !show;
  if (cardEl) cardEl.setAttribute('aria-expanded', String(show));
}

/**
 * Simple string hash for cache key comparison.
 * Not cryptographic — just needs to detect when the archive has changed.
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

/**
 * Attempt thematic clustering of archived entries via on-device AI.
 * Re-renders the feed grouped by AI-suggested themes instead of domain.
 */
async function clusterByTheme() {
  const { archived } = await chrome.storage.local.get('archived');
  if (!archived || archived.length === 0) return;

  // Build a summary of all entries for clustering
  const summaries = archived.map((item, i) =>
    `[${i}] ${item.title}: ${(item.summary || '').substring(0, 100)}`
  ).join('\n');

  try {
    const session = await createAiSession();
    const prompt = `Group these summaries into thematic clusters and suggest short cluster titles. Return JSON: { "clusters": [{ "title": "...", "indices": [0, 1, ...] }] }\n\n${summaries}`;
    const result = await session.prompt(prompt);
    session.destroy();

    // Try to parse the AI response as JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      renderClusters(parsed.clusters, archived);
    }
  } catch {
    // AI clustering failed — fall back to domain grouping
    await loadAndRenderContent();
  }
}

/**
 * Render archive entries grouped by AI-suggested thematic clusters.
 */
function renderClusters(clusters, archived) {
  const feedEl = document.getElementById('archive-feed');
  feedEl.innerHTML = '';

  for (const cluster of clusters) {
    const groupSection = document.createElement('section');
    groupSection.className = 'archive-group';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <h3 class="group-title">${cluster.title || 'CLUSTER'}</h3>
      <div class="group-actions">
        <button class="restore-group-btn" data-indices="${cluster.indices.join(',')}">Restore Group</button>
      </div>
    `;
    groupSection.appendChild(header);

    const grid = document.createElement('div');
    grid.style.display = 'flex';
    grid.style.flexDirection = 'column';
    grid.style.gap = '1.5rem';

    for (const idx of cluster.indices) {
      if (archived[idx]) {
        grid.appendChild(createCard(archived[idx]));
      }
    }

    groupSection.appendChild(grid);
    feedEl.appendChild(groupSection);
  }

  setupEventListeners();
}

// Utility: Group array of objects by key
function groupBy(array, key) {
  return array.reduce((result, currentValue) => {
    // handle nested keys if needed, here simple
    const groupKey = currentValue[key] || 'Other';
    (result[groupKey] = result[groupKey] || []).push(currentValue);
    return result;
  }, {});
}

// ─── Search / Filter ────────────────────────────────────────────

/**
 * Set up the search input to filter archive cards in real-time.
 * Matches against title, URL, summary, and domain.
 */
function setupSearchFilter() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applySearchFilter(searchInput.value.trim().toLowerCase());
    }, 200);
  });
}

/**
 * Show/hide archive cards and groups based on a search query.
 * Empty query shows everything.
 */
function applySearchFilter(query) {
  const groups = document.querySelectorAll('.archive-group');
  const emptyState = document.querySelector('.empty-state');
  const noResults = document.getElementById('no-results');

  if (!query) {
    // Show everything
    groups.forEach((g) => { g.hidden = false; });
    groups.forEach((g) => {
      g.querySelectorAll('.archive-card').forEach((c) => { c.hidden = false; });
    });
    if (noResults) noResults.hidden = true;
    return;
  }

  let anyVisible = false;

  groups.forEach((group) => {
    const cards = group.querySelectorAll('.archive-card');
    let groupHasVisible = false;

    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      const matchesSearch = text.includes(query);
      card.hidden = !matchesSearch;
      if (matchesSearch) groupHasVisible = true;
    });

    group.hidden = !groupHasVisible;
    if (groupHasVisible) anyVisible = true;
  });

  // Show "no results" message if nothing matches
  if (noResults) {
    noResults.hidden = anyVisible;
  }
}

// ─── Export ──────────────────────────────────────────────────────

/**
 * Set up export buttons for JSON and CSV download.
 */
function setupExportButtons() {
  const jsonBtn = document.getElementById('export-json');
  const csvBtn = document.getElementById('export-csv');

  if (jsonBtn) {
    jsonBtn.addEventListener('click', async () => {
      const { archived } = await chrome.storage.local.get('archived');
      if (!archived || archived.length === 0) return;

      const blob = new Blob([JSON.stringify(archived, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `closure-archive-${formatDateForFilename()}.json`);
    });
  }

  if (csvBtn) {
    csvBtn.addEventListener('click', async () => {
      const { archived } = await chrome.storage.local.get('archived');
      if (!archived || archived.length === 0) return;

      const csv = archiveToCsv(archived);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `closure-archive-${formatDateForFilename()}.csv`);
    });
  }
}

/**
 * Convert archived entries to CSV format.
 */
function archiveToCsv(archived) {
  const headers = ['Title', 'URL', 'Domain', 'Summary', 'Summary Type', 'Archived At'];
  const rows = archived.map((item) => [
    escapeCsv(item.title || ''),
    escapeCsv(item.url || ''),
    escapeCsv(item.domain || ''),
    escapeCsv(item.summary || ''),
    escapeCsv(item.summaryType || ''),
    escapeCsv(new Date(item.timestamp).toISOString()),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

function escapeCsv(value) {
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Trigger a file download from a Blob — no network request needed.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Clean up after a tick
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

function formatDateForFilename() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Wire up the Archive Now and Sweep Now buttons in the stats cards.
 */
function setupActionButtons() {
  const archiveBtn = document.getElementById('archive-now');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      archiveBtn.disabled = true;
      archiveBtn.textContent = 'Archiving…';

      try {
        const response = await chrome.runtime.sendMessage({ action: 'nuclearArchive' });
        const count = response?.count || 0;

        if (count === 0) {
          archiveBtn.textContent = 'No idle tabs';
        } else {
          archiveBtn.textContent = `${count} archived`;
          // Refresh the whole page to show newly archived tabs
          await loadAndRenderContent();
        }
      } catch (err) {
        archiveBtn.textContent = 'Error';
        console.error('[Closure] Archive error:', err);
      }

      setTimeout(() => {
        archiveBtn.disabled = false;
        archiveBtn.textContent = 'Archive Now';
      }, 3000);
    });
  }

  const sweepBtn = document.getElementById('sweep-now');
  if (sweepBtn) {
    sweepBtn.addEventListener('click', async () => {
      sweepBtn.disabled = true;
      sweepBtn.textContent = 'Sweeping…';

      try {
        const before = await chrome.storage.local.get('swept');
        const countBefore = (before.swept || []).length;

        await chrome.runtime.sendMessage({ action: 'runSweep' });

        const after = await chrome.storage.local.get('swept');
        const countAfter = (after.swept || []).length;
        const delta = countAfter - countBefore;

        if (delta === 0) {
          sweepBtn.textContent = 'All clear';
        } else {
          sweepBtn.textContent = `${delta} swept`;
          // Refresh to show newly swept tabs in the feed
          await loadAndRenderContent();
        }
      } catch (err) {
        sweepBtn.textContent = 'Error';
        console.error('[Closure] Sweep error:', err);
      }

      setTimeout(() => {
        sweepBtn.disabled = false;
        sweepBtn.textContent = 'Sweep Now';
      }, 3000);
    });
  }
}
