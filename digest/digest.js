/**
 * Closure — Sunday Digest (digest.js)
 * 
 * Renders the weekly archival dashboard.
 * - Restores tabs/groups
 * - Displays local stats
 * - Handles simple client-side sorting/filtering (no extra network calls)
 */

document.addEventListener('DOMContentLoaded', async () => {
  renderDate();
  await loadAndRenderContent();
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
  // In Phase 3 (Soul), we might add "Cluster by Theme" here
  const groups = groupBy(archived, 'domain');
  
  // Sort domains alphabetically for stability, or by count
  const sortedDomains = Object.keys(groups).sort();

  sortedDomains.forEach(domain => {
    const items = groups[domain];
    
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
  const displayTime = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Summary Handling
  let summaryHtml = '';
  if (item.summaryType === 'ai' && item.summary) {
    // Expecting summary to be a string of bullets or text
    // If it's pure text, wrap in p. If it looks like a list, parse it.
    // For now, assume simple text block or pre-formatted bullets.
    summaryHtml = `<div class="card-summary">${formatSummary(item.summary)}</div>`;
  } else {
    // Fallback: snippet of text
    const snippet = (item.fallbackText || '').substring(0, 150) + '...';
    summaryHtml = `<div class="card-summary"><p>${snippet}</p></div>`;
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
      <span class="timestamp">Archived ${displayTime}</span>
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

function setupEventListeners() {
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

  // Cluster button (Stub for Phase 3)
  const clusterBtn = document.getElementById('cluster-btn');
  if (clusterBtn) {
    if (window.ai) {
      clusterBtn.disabled = false;
      clusterBtn.addEventListener('click', () => {
        alert('AI Clustering coming in Phase 3!');
      });
    }
  }
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
