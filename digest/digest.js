#!/usr/bin/env node
/**
 * Closure — Memory Lane (digest.js)
 * @version 1.6.1
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
  const { archived, stats, config } = await chrome.storage.local.get(['archived', 'stats', 'config']);
  
  // Render Stats
  document.getElementById('total-archived').textContent = stats?.tabsTidiedThisWeek || 0;
  
  const savedMb = stats?.ramSavedEstimate || 0;
  document.getElementById('ram-saved').textContent = savedMb >= 1024 
    ? `${(savedMb/1024).toFixed(1)} GB` 
    : `${Math.round(savedMb)} MB`;

  // Provide simple topic count estimate (unique domains)
  const domains = new Set((archived || []).map(item => item.domain));
  const uniqueTopics = domains.size;
  document.getElementById('topics-explored').textContent = uniqueTopics;
  document.getElementById('footer-topics-count').textContent = uniqueTopics;

  // Render Feed
  const feedEl = document.getElementById('archive-feed');
  if (!archived || archived.length === 0) {
    return; // Leave empty state visible
  }

  // Clear empty state
  feedEl.innerHTML = '';
  
  // Group by Domain (default)
  const sortMode = document.getElementById('sort-select')?.value || 'recency';
  const groups = groupBy(archived, 'domain');
  
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

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'archive-card';
  
  // Safe Fallbacks
  const title = item.title || 'Untitled Page';
  const url = item.url || '#';
  const archiveDate = new Date(item.timestamp);
  const displayDate = archiveDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const displayTime = archiveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Summary Handling
  let summaryHtml = '';
  if (item.summary) {
    if (item.summaryType === 'ai') {
      summaryHtml = `<div class="card-summary">${formatSummary(item.summary)}</div>`;
    } else {
      // Fallback summary — show a truncated snippet
      const snippet = item.summary.substring(0, 200);
      summaryHtml = `<div class="card-summary"><p>${snippet}</p></div>`;
    }
  }
  
  card.innerHTML = `
    <img src="${item.favicon || '../icons/icon-48.png'}" alt="" class="card-favicon" onerror="this.src='../icons/icon-48.png'">
    <div class="card-content">
      <h4 class="card-title">
        <a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
      </h4>
      ${summaryHtml}
    </div>
    <div class="card-footer">
      <span class="timestamp">Archived ${displayDate} at ${displayTime}</span>
      <button class="restore-btn" data-url="${url}">Restore Tab</button>
    </div>
  `;

  return card;
}

function formatSummary(text) {
  // Rudimentary bullet parsing if AI returns raw text with dashes
  if (text.includes('\n-')) {
    const items = text.split('\n-').filter(l => l.trim().length > 0).map(l => `<li>${l.replace(/^-/, '').trim()}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  return `<p>${text}</p>`;
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
    }
  });

  // Cluster button — enable when AI is available (try new LanguageModel global, then legacy window.ai)
  const clusterBtn = document.getElementById('cluster-btn');
  const aiHint = document.getElementById('ai-hint');
  const aiHintLink = document.getElementById('ai-hint-link');
  if (clusterBtn) {
    const aiReady = await isAiAvailable();
    if (aiReady) {
      clusterBtn.disabled = false;
      if (aiHint) aiHint.hidden = true;
      clusterBtn.addEventListener('click', async () => {
        clusterBtn.disabled = true;
        clusterBtn.textContent = 'Clustering...';
        try {
          await clusterByTheme();
        } catch (err) {
          console.error('[Closure] Clustering error:', err);
          clusterBtn.textContent = 'Clustering failed';
        }
      });
    } else {
      // Show the AI hint when AI is unavailable
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
      // Persist sort preference
      const { config } = await chrome.storage.local.get('config');
      if (config) {
        config.archiveSortBy = sortSelect.value;
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
