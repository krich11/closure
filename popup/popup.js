#!/usr/bin/env node
/**
 * Closure — Popup script (popup.js)
 * @version 1.7.1
 */

document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get(['config', 'stats']);
  const tabs = await chrome.tabs.query({});

  // Tab count
  const countEl = document.getElementById('tab-count');
  if (countEl) {
    countEl.textContent = `${tabs.length} tabs open`;
  }

  // Status ring color
  const ring = document.getElementById('status-ring');
  if (ring) {
    if (tabs.length <= 15) {
      ring.dataset.health = 'green';
    } else if (tabs.length <= 30) {
      ring.dataset.health = 'yellow';
    } else {
      ring.dataset.health = 'red';
    }
  }

  // Stats
  const stats = data.stats || { tabsTidiedThisWeek: 0, ramSavedEstimate: 0 };
  const tidiedEl = document.getElementById('tabs-tidied');
  if (tidiedEl) {
    tidiedEl.textContent = `${stats.tabsTidiedThisWeek} tabs tidied this week`;
  }
  const ramEl = document.getElementById('ram-saved');
  if (ramEl) {
    const mbSaved = stats.ramSavedEstimate;
    ramEl.textContent = mbSaved >= 1024
      ? `~${(mbSaved / 1024).toFixed(1)} GB RAM saved`
      : `~${mbSaved} MB RAM saved`;
  }

  // Memory Lane link
  const digestLink = document.getElementById('open-digest');
  if (digestLink) {
    digestLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('digest/digest.html') });
    });
  }

  // Settings link
  const settingsLink = document.getElementById('open-settings');
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    });
  }

  // Nuclear Archive button
  const archiveBtn = document.getElementById('archive-now');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      archiveBtn.disabled = true;
      archiveBtn.textContent = 'Archiving...';

      try {
        const response = await chrome.runtime.sendMessage({ action: 'nuclearArchive' });
        const count = response?.count || 0;

        if (count === 0) {
          archiveBtn.textContent = 'No idle tabs found';
        } else {
          archiveBtn.textContent = `Archived ${count} tab${count > 1 ? 's' : ''}`;
          showNuclearToast(count);
          refreshStats();
        }
      } catch (err) {
        archiveBtn.textContent = 'Error — try again';
        console.error('[Closure] Nuclear archive error:', err);
      }

      // Re-enable after 3 seconds
      setTimeout(() => {
        archiveBtn.disabled = false;
        archiveBtn.textContent = 'Archive Idle Tabs Now';
      }, 3000);
    });
  }

  // Cluster by Topic button — always visible for manual trigger
  const clusterBtn = document.getElementById('cluster-now');
  if (clusterBtn) {
    clusterBtn.hidden = false;

    clusterBtn.addEventListener('click', async () => {
      clusterBtn.disabled = true;
      clusterBtn.textContent = 'Clustering...';

      try {
        await chrome.runtime.sendMessage({ action: 'runTopicGrouping' });
        clusterBtn.textContent = 'Done!';
      } catch (err) {
        clusterBtn.textContent = 'Error — try again';
        console.error('[Closure] Topic grouping error:', err);
      }

      setTimeout(() => {
        clusterBtn.disabled = false;
        clusterBtn.textContent = 'Cluster by Topic';
      }, 3000);
    });
  }
});

/**
 * Show a toast message after a large nuclear archive operation.
 * Only shows for > 20 tabs (per spec) with donation prompt.
 *
 * @param {number} count
 */
function showNuclearToast(count) {
  // Remove existing toast if any
  const existing = document.getElementById('nuclear-toast');
  if (existing) existing.remove();

  const ramMb = count * 50;
  const ramText = ramMb >= 1024
    ? `${(ramMb / 1024).toFixed(1)} GB`
    : `${ramMb} MB`;

  const toast = document.createElement('div');
  toast.id = 'nuclear-toast';
  toast.className = 'nuclear-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  if (count > 20) {
    toast.innerHTML = `
      <p>Ah, silence — and you just reclaimed ~${ramText} RAM. Enjoy the focus.</p>
      <p class="toast-donate">This runs 100% locally. Support the code that keeps your privacy safe.</p>
      <a href="https://ko-fi.com/krich11" target="_blank" rel="noopener noreferrer" class="toast-link">Support Us</a>
    `;
  } else {
    toast.innerHTML = `<p>${count} tab${count > 1 ? 's' : ''} archived. ~${ramText} RAM reclaimed.</p>`;
  }

  document.getElementById('popup-main').appendChild(toast);

  // Auto-remove after 8 seconds
  setTimeout(() => toast.remove(), 8000);
}

/**
 * Refresh the stats display after an archive operation.
 */
async function refreshStats() {
  const { stats } = await chrome.storage.local.get('stats');
  if (!stats) return;

  const tidiedEl = document.getElementById('tabs-tidied');
  if (tidiedEl) {
    tidiedEl.textContent = `${stats.tabsTidiedThisWeek} tabs tidied this week`;
  }

  const ramEl = document.getElementById('ram-saved');
  if (ramEl) {
    const mbSaved = stats.ramSavedEstimate;
    ramEl.textContent = mbSaved >= 1024
      ? `~${(mbSaved / 1024).toFixed(1)} GB RAM saved`
      : `~${mbSaved} MB RAM saved`;
  }

  // Update tab count too
  const tabs = await chrome.tabs.query({});
  const countEl = document.getElementById('tab-count');
  if (countEl) {
    countEl.textContent = `${tabs.length} tabs open`;
  }
}
