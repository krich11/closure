#!/usr/bin/env node
/**
 * Closure — Popup script (popup.js)
 * @version 2.0.5
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

});
