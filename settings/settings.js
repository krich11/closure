#!/usr/bin/env node
/**
 * Closure — Settings page (settings.js)
 * @version 2.0.1
 *
 * Loads config from chrome.storage.local, binds controls,
 * auto-saves on change. No network calls.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const { config } = await chrome.storage.local.get('config');
  const cfg = config || {};

  bindRangeSlider('group-threshold', 'group-threshold-value', cfg.groupThreshold ?? 3, formatInt);
  bindRangeSlider('idle-threshold', 'idle-threshold-value', cfg.idleThresholdHours ?? 24, v => `${v}h`);
  bindRangeSlider('retention-days', 'retention-days-value', cfg.archiveRetentionDays ?? 0, formatRetention);

  bindToggle('per-window-grouping', cfg.perWindowGrouping ?? false);
  bindToggle('enable-clustering', cfg.enableThematicClustering ?? false);
  bindToggle('high-contrast', cfg.highContrastMode ?? false);
  bindToggle('enable-debug', cfg.enableDebugTools ?? false);

  // Archive sort preference
  bindSelect('archive-sort', cfg.archiveSortBy ?? 'recency');

  // Rich page analysis — permission-gated, handled separately from normal toggles
  await initRichAnalysisToggle(cfg.enableRichPageAnalysis ?? false);

  // Master AI toggle — gates all AI sub-controls
  await initAiMasterToggle(cfg.enableAI ?? false, cfg.aiSupporterCode ?? cfg.aiLicenseKey ?? '', cfg.aiActivated ?? false);
  aiActivatedFlag = cfg.aiActivated ?? false;

  // Topic grouping controls
  bindToggle('enable-topic-grouping', cfg.enableTopicGrouping ?? false);
  bindToggle('topic-grouping-overnight', cfg.topicGroupingOvernightOnly ?? false);
  bindSelect('topic-grouping-interval', cfg.topicGroupingIntervalMinutes ?? 120);
  updateTopicGroupingVisibility(cfg.enableTopicGrouping ?? false);
  updateOvernightInteractivity();

  applyHighContrast(cfg.highContrastMode ?? false);
  checkAiAvailability();
  loadWhitelist(cfg.whitelist ?? []);
  setupWhitelistInput();
  setupClearStorage();
  setupZeroize();
  updateZeroizeVisibility(cfg.enableDebugTools ?? false);
  checkIncognito();
});

// ─── Range Slider Binding ─────────────────────────────────────────

/**
 * Bind a range input to its output display and auto-save on change.
 */
function bindRangeSlider(inputId, outputId, initialValue, formatter) {
  const input = document.getElementById(inputId);
  const output = document.getElementById(outputId);
  if (!input || !output) return;

  input.value = initialValue;
  output.textContent = formatter(initialValue);

  input.addEventListener('input', () => {
    output.textContent = formatter(input.value);
  });

  input.addEventListener('change', () => {
    saveConfig();
  });
}

function formatInt(v) {
  return String(v);
}

function formatRetention(v) {
  const days = parseInt(v, 10);
  if (days === 0) return 'Forever';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? '~1 month' : `~${months} months`;
  }
  return '1 year';
}

// ─── Select Binding ───────────────────────────────────────────────

/**
 * Bind a <select> element, set its initial value, and auto-save on change.
 */
function bindSelect(selectId, initialValue) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.value = String(initialValue);

  select.addEventListener('change', () => {
    saveConfig();
  });
}

// ─── Topic Grouping Visibility ────────────────────────────────────

/**
 * Show/hide the topic grouping sub-options based on the toggle state.
 */
function updateTopicGroupingVisibility(enabled) {
  const options = document.getElementById('topic-grouping-options');
  if (options) {
    options.hidden = !enabled;
  }
}

/**
 * When "overnight only" is on, disable the interval select — the alarm
 * fires once at 2 AM regardless of the chosen frequency.
 */
function updateOvernightInteractivity() {
  const overnightBtn = document.getElementById('topic-grouping-overnight');
  const intervalSelect = document.getElementById('topic-grouping-interval');
  if (!overnightBtn || !intervalSelect) return;

  const isOvernight = overnightBtn.getAttribute('aria-checked') === 'true';
  intervalSelect.disabled = isOvernight;
  intervalSelect.classList.toggle('field-select--disabled', isOvernight);
}

// ─── Rich Page Analysis (Permission-Gated Toggle) ────────────────

// ─── Supporter Code Validation ────────────────────────────────────

// Module-level flag: true once a valid supporter code has been entered.
// Persisted to storage so supporters are grandfathered across code rotations.
let aiActivatedFlag = false;

/**
 * Valid supporter code hashes (SHA-256, hex-encoded).
 * To add a new code: run in DevTools console:
 *   crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR-CODE')).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
 * Then add the resulting hash to this array.
 */
const VALID_CODE_HASHES = [
  // CLOSURE-SUPPORTER-2026
  '913e13aa306177e8c0bb6302571ef7a9739803857d07337f9e66b345f463df21',
];

/**
 * Hash a supporter code with SHA-256 and return hex string.
 * Uses Web Crypto API (built-in, no network).
 */
async function hashCode(code) {
  const data = new TextEncoder().encode(code.trim().toUpperCase());
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate a supporter code against the known hash list.
 */
async function isValidSupporterCode(code) {
  if (!code || !code.trim()) return false;
  const hash = await hashCode(code);
  return VALID_CODE_HASHES.includes(hash);
}

// ─── Master AI Toggle (Supporter Code Gated) ──────────────────────

/**
 * Initialize the master AI toggle. When turning ON:
 * - If a valid supporter code is already stored, activate immediately.
 * - If not, reveal the supporter code input gate.
 * When turning OFF, gray out all AI sub-controls.
 */
async function initAiMasterToggle(enabled, storedKey, alreadyActivated) {
  const btn = document.getElementById('enable-ai');
  const gateEl = document.getElementById('ai-license-gate');
  const inputEl = document.getElementById('ai-license-input');
  const submitBtn = document.getElementById('ai-license-submit');
  const errorEl = document.getElementById('ai-license-error');
  if (!btn) return;

  // Pre-fill the stored code (masked display)
  if (storedKey && inputEl) {
    inputEl.value = storedKey;
  }

  btn.setAttribute('aria-checked', String(!!enabled));
  applyAiDisabledState(!enabled);

  btn.addEventListener('click', async () => {
    const current = btn.getAttribute('aria-checked') === 'true';

    if (current) {
      // Turning OFF — just toggle and gray everything out
      btn.setAttribute('aria-checked', 'false');
      applyAiDisabledState(true);
      if (gateEl) gateEl.hidden = true;
      saveConfig();
      return;
    }

    // Turning ON — grandfathered supporters skip validation
    if (aiActivatedFlag) {
      btn.setAttribute('aria-checked', 'true');
      applyAiDisabledState(false);
      if (gateEl) gateEl.hidden = true;
      saveConfig();
      return;
    }

    // Check for stored supporter code
    const existingKey = inputEl?.value?.trim();
    if (existingKey && await isValidSupporterCode(existingKey)) {
      // Valid code already stored — activate immediately
      btn.setAttribute('aria-checked', 'true');
      applyAiDisabledState(false);
      if (gateEl) gateEl.hidden = true;
      aiActivatedFlag = true;
      saveConfig();
    } else {
      // No code or invalid — show the gate (don't toggle yet)
      if (gateEl) {
        gateEl.hidden = false;
        if (inputEl) inputEl.value = ''; // clear any invalid stored code
        inputEl?.focus();
      }
    }
  });

  // Supporter code submit handler
  if (submitBtn && inputEl) {
    const activateKey = async () => {
      const code = inputEl.value.trim();
      if (!code) {
        showLicenseError('Please enter your supporter code.');
        return;
      }
      if (!await isValidSupporterCode(code)) {
        showLicenseError('Invalid code. Check your Ko-fi donation receipt and try again.');
        return;
      }
      // Valid — store and activate, set grandfathered flag
      btn.setAttribute('aria-checked', 'true');
      applyAiDisabledState(false);
      if (gateEl) gateEl.hidden = true;
      if (errorEl) errorEl.hidden = true;
      aiActivatedFlag = true;
      saveConfig();
      showSaveStatus('AI activated — thank you for your support!');
    };

    submitBtn.addEventListener('click', activateKey);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        activateKey();
      }
    });
  }
}

function showLicenseError(msg) {
  const el = document.getElementById('ai-license-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

/**
 * Enable/disable all AI sub-controls. When disabled, the controls
 * are visually grayed out and non-interactive — a dormant state.
 */
function applyAiDisabledState(disabled) {
  const subControls = document.getElementById('ai-sub-controls');
  const topicGate = document.getElementById('topic-grouping-gate');

  if (subControls) {
    subControls.classList.toggle('ai-sub-controls--disabled', disabled);
  }
  if (topicGate) {
    topicGate.classList.toggle('ai-gated-control--disabled', disabled);
  }
}

// ─── Rich Page Analysis (Permission-Gated Toggle) ────────────────

const RICH_ANALYSIS_PERMS = {
  permissions: ['scripting'],
  origins: ['<all_urls>'],
};

/**
 * Initialize the rich page analysis toggle.
 * Checks actual granted permissions to set correct initial state —
 * the config value alone isn't trustworthy because the user could have
 * revoked permissions from chrome://extensions.
 */
async function initRichAnalysisToggle(configValue) {
  const btn = document.getElementById('enable-rich-analysis');
  const statusEl = document.getElementById('rich-analysis-status');
  if (!btn) return;

  // Check if permissions are actually granted (user may have revoked externally)
  const hasPermission = await chrome.permissions.contains(RICH_ANALYSIS_PERMS);
  const enabled = configValue && hasPermission;

  btn.setAttribute('aria-checked', String(enabled));

  // If config says enabled but permission is revoked, fix the drift
  if (configValue && !hasPermission) {
    showRichAnalysisStatus('Permission was revoked — re-enable to restore rich analysis.', 'warning');
  }

  btn.addEventListener('click', async () => {
    const current = btn.getAttribute('aria-checked') === 'true';

    if (current) {
      // Turning OFF — revoke permissions
      try {
        await chrome.permissions.remove(RICH_ANALYSIS_PERMS);
        btn.setAttribute('aria-checked', 'false');
        showRichAnalysisStatus('Rich page analysis disabled. Permissions revoked.', 'info');
        saveConfig();
      } catch (err) {
        showRichAnalysisStatus('Could not revoke permissions: ' + err.message, 'error');
      }
    } else {
      // Turning ON — request permissions (Chrome shows its own dialog)
      try {
        const granted = await chrome.permissions.request(RICH_ANALYSIS_PERMS);
        if (granted) {
          btn.setAttribute('aria-checked', 'true');
          showRichAnalysisStatus('Rich page analysis enabled. Closure can now read page content for better grouping and summaries.', 'success');
          saveConfig();
        } else {
          showRichAnalysisStatus('Permission denied. Rich page analysis requires access to page content.', 'warning');
        }
      } catch (err) {
        showRichAnalysisStatus('Permission request failed: ' + err.message, 'error');
      }
    }
  });
}

function showRichAnalysisStatus(message, type) {
  const el = document.getElementById('rich-analysis-status');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.className = `rich-analysis-status rich-analysis-status--${type}`;
  // Auto-hide success/info after 5 seconds
  if (type === 'success' || type === 'info') {
    setTimeout(() => { el.hidden = true; }, 5000);
  }
}

// ─── Toggle Switch Binding ────────────────────────────────────────

function bindToggle(buttonId, initialValue) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  btn.setAttribute('aria-checked', String(!!initialValue));

  btn.addEventListener('click', () => {
    const current = btn.getAttribute('aria-checked') === 'true';
    btn.setAttribute('aria-checked', String(!current));

    if (buttonId === 'high-contrast') {
      applyHighContrast(!current);
    }

    if (buttonId === 'enable-topic-grouping') {
      updateTopicGroupingVisibility(!current);
    }

    if (buttonId === 'enable-debug') {
      updateZeroizeVisibility(!current);
    }

    if (buttonId === 'topic-grouping-overnight') {
      updateOvernightInteractivity();
    }

    saveConfig();
  });
}

// ─── Save Config ──────────────────────────────────────────────────

async function saveConfig() {
  const newConfig = {
    groupThreshold: parseInt(document.getElementById('group-threshold')?.value, 10) || 3,
    perWindowGrouping: document.getElementById('per-window-grouping')?.getAttribute('aria-checked') === 'true',
    idleThresholdHours: parseInt(document.getElementById('idle-threshold')?.value, 10) || 24,
    archiveRetentionDays: parseInt(document.getElementById('retention-days')?.value, 10) || 0,
    archiveSortBy: document.getElementById('archive-sort')?.value || 'recency',
    enableAI: document.getElementById('enable-ai')?.getAttribute('aria-checked') === 'true',
    aiSupporterCode: document.getElementById('ai-license-input')?.value?.trim() || '',
    aiActivated: aiActivatedFlag,
    enableThematicClustering: document.getElementById('enable-clustering')?.getAttribute('aria-checked') === 'true',
    enableRichPageAnalysis: document.getElementById('enable-rich-analysis')?.getAttribute('aria-checked') === 'true',
    enableTopicGrouping: document.getElementById('enable-topic-grouping')?.getAttribute('aria-checked') === 'true',
    topicGroupingIntervalMinutes: parseInt(document.getElementById('topic-grouping-interval')?.value, 10) || 120,
    topicGroupingOvernightOnly: document.getElementById('topic-grouping-overnight')?.getAttribute('aria-checked') === 'true',
    highContrastMode: document.getElementById('high-contrast')?.getAttribute('aria-checked') === 'true',
    enableDebugTools: document.getElementById('enable-debug')?.getAttribute('aria-checked') === 'true',
    whitelist: getWhitelistFromDOM(),
  };

  await chrome.storage.local.set({ config: newConfig });

  // Tell the service worker to reschedule the topic grouping alarm
  try {
    await chrome.runtime.sendMessage({ action: 'rescheduleTopicGrouping' });
  } catch {
    // Service worker may not be running yet
  }

  showSaveStatus('Settings saved');
}

function showSaveStatus(message) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => {
    el.classList.remove('visible');
  }, 2000);
}

// ─── High Contrast ───────────────────────────────────────────────

function applyHighContrast(enabled) {
  document.documentElement.classList.toggle('high-contrast', enabled);
}

// ─── AI Availability Check ───────────────────────────────────────

async function checkAiAvailability() {
  const statusEl = document.getElementById('ai-status');
  const guideEl = document.getElementById('ai-setup-guide');
  if (!statusEl) return;

  let aiAvailable = false;

  try {
    // Try the new global LanguageModel API (Chrome 138+), then fall back to legacy window.ai
    if (typeof LanguageModel !== 'undefined') {
      const availability = await LanguageModel.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      if (availability === 'available' || availability === 'readily') {
        statusEl.textContent = 'On-device AI is available and ready.';
        statusEl.className = 'ai-status ai-status--available';
        aiAvailable = true;
      } else if (availability === 'downloadable' || availability === 'after-download' || availability === 'downloading') {
        statusEl.textContent = `On-device AI adapter status: "${availability}". The base model is installed but the Prompt API adapter needs to download.`;
        statusEl.className = 'ai-status ai-status--pending';
        showDownloadButton();
      } else {
        statusEl.textContent = `On-device AI is not available (status: "${availability}"). Make sure both flags are enabled and Chrome has been fully restarted. Summaries will use fallback text.`;
        statusEl.className = 'ai-status ai-status--unavailable';
      }
    } else if (typeof window.ai !== 'undefined' && window.ai?.languageModel) {
      // Legacy API fallback
      const capabilities = await window.ai.languageModel.capabilities();
      if (capabilities.available === 'readily') {
        statusEl.textContent = 'On-device AI is available and ready.';
        statusEl.className = 'ai-status ai-status--available';
        aiAvailable = true;
      } else if (capabilities.available === 'after-download') {
        statusEl.textContent = 'On-device AI model needs to download first. Open chrome://components and click "Check for update" on Optimization Guide On Device Model.';
        statusEl.className = 'ai-status ai-status--pending';
      } else {
        statusEl.textContent = 'On-device AI is not available. Summaries will use fallback text.';
        statusEl.className = 'ai-status ai-status--unavailable';
      }
    } else {
      statusEl.textContent = 'On-device AI is not available in this browser. Requires Chrome 138+. Summaries will use fallback text.';
      statusEl.className = 'ai-status ai-status--unavailable';
    }
  } catch {
    statusEl.textContent = 'Could not check AI status. Summaries will use fallback text.';
    statusEl.className = 'ai-status ai-status--unavailable';
  }

  // Show or hide the setup guide
  if (guideEl) {
    guideEl.hidden = aiAvailable;
  }

  // Wire up chrome:// link click handlers
  setupChromeLinks();
}

/**
 * Show and wire the "Download AI Model" button.
 * Calling LanguageModel.create() when status is "downloadable" triggers
 * Chrome to pull the kPromptApi adaptation automatically.
 */
function showDownloadButton() {
  const btn = document.getElementById('ai-download-btn');
  const statusEl = document.getElementById('ai-status');
  if (!btn) return;

  btn.hidden = false;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    statusEl.textContent = 'Downloading AI adapter — this may take a few minutes…';
    statusEl.className = 'ai-status ai-status--pending';

    try {
      const session = await LanguageModel.create({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const pct = Math.round((e.loaded / e.total) * 100);
            btn.textContent = `Downloading… ${pct}%`;
            statusEl.textContent = `Downloading AI adapter: ${pct}%`;
          });
        },
      });
      session.destroy();

      btn.hidden = true;
      statusEl.textContent = 'On-device AI is available and ready.';
      statusEl.className = 'ai-status ai-status--available';

      const guideEl = document.getElementById('ai-setup-guide');
      if (guideEl) guideEl.hidden = true;
    } catch (err) {
      btn.textContent = 'Download failed — Retry';
      btn.disabled = false;
      statusEl.textContent = `AI adapter download failed: ${err.message}. Try restarting Chrome and clicking again.`;
      statusEl.className = 'ai-status ai-status--unavailable';
    }
  }, { once: true });
}

/**
 * Make chrome:// URLs clickable by opening them via chrome.tabs.create.
 * Regular <a> links to chrome:// are blocked by the browser.
 */
function setupChromeLinks() {
  document.querySelectorAll('.chrome-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('data-url');
      if (url) {
        chrome.tabs.create({ url });
      }
    });
  });
}

// ─── Whitelist Management ────────────────────────────────────────

function loadWhitelist(domains) {
  const listEl = document.getElementById('whitelist-entries');
  const emptyEl = document.getElementById('whitelist-empty');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (domains.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;

  for (const domain of domains) {
    appendWhitelistEntry(domain);
  }
}

function appendWhitelistEntry(domain) {
  const listEl = document.getElementById('whitelist-entries');
  const emptyEl = document.getElementById('whitelist-empty');
  if (!listEl) return;
  if (emptyEl) emptyEl.hidden = true;

  const li = document.createElement('li');
  li.className = 'whitelist-item';
  li.draggable = true;
  li.innerHTML = `
    <span class="whitelist-grip" aria-hidden="true">&#x2630;</span>
    <span class="whitelist-domain">${domain}</span>
    <button class="whitelist-remove" type="button" aria-label="Remove ${domain} from whitelist">&times;</button>
  `;

  li.querySelector('.whitelist-remove').addEventListener('click', () => {
    li.remove();
    const remaining = document.querySelectorAll('.whitelist-item');
    if (remaining.length === 0 && emptyEl) emptyEl.hidden = false;
    saveConfig();
  });

  // ── Drag-and-drop reorder ──
  li.addEventListener('dragstart', (e) => {
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Small delay so the dragging class applies visually before the ghost
    requestAnimationFrame(() => li.style.opacity = '0.4');
  });

  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    li.style.opacity = '';
    // Remove any leftover drop indicators
    listEl.querySelectorAll('.whitelist-item').forEach(el => {
      el.classList.remove('drag-over-above', 'drag-over-below');
    });
    saveConfig();
  });

  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = listEl.querySelector('.dragging');
    if (!dragging || dragging === li) return;

    // Determine if cursor is in top or bottom half of the item
    const rect = li.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const above = e.clientY < midY;

    li.classList.toggle('drag-over-above', above);
    li.classList.toggle('drag-over-below', !above);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drag-over-above', 'drag-over-below');
  });

  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragging = listEl.querySelector('.dragging');
    if (!dragging || dragging === li) return;

    const rect = li.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      listEl.insertBefore(dragging, li);
    } else {
      listEl.insertBefore(dragging, li.nextSibling);
    }

    li.classList.remove('drag-over-above', 'drag-over-below');
  });

  listEl.appendChild(li);
}

function setupWhitelistInput() {
  const input = document.getElementById('whitelist-input');
  const addBtn = document.getElementById('whitelist-add');
  if (!input || !addBtn) return;

  const showError = (msg) => {
    const errEl = document.getElementById('whitelist-error');
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = false;
    setTimeout(() => { errEl.hidden = true; }, 3000);
  };

  const addDomain = () => {
    const raw = input.value.trim().toLowerCase();
    if (!raw) return;

    // Normalize: strip protocol, path, query, hash, port, www
    let domain = raw
      .replace(/^https?:\/\//, '')
      .replace(/[/?#].*$/, '')      // strip path, query, hash
      .replace(/:\d+$/, '')          // strip port
      .replace(/^www\./, '');
    if (!domain) return;

    // Validate: must look like a hostname or IP
    const isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(domain);
    const isLocalhost = domain === 'localhost';
    const isDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
    if (!isIP && !isLocalhost && !isDomain) {
      showError('Enter a valid domain (e.g. example.com) or IP address.');
      return;
    }

    // Avoid duplicates
    const existing = getWhitelistFromDOM();
    if (existing.includes(domain)) {
      input.value = '';
      showError(`${domain} is already whitelisted.`);
      return;
    }

    appendWhitelistEntry(domain);
    input.value = '';
    saveConfig();
  };

  addBtn.addEventListener('click', addDomain);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDomain();
    }
  });
}

function getWhitelistFromDOM() {
  const items = document.querySelectorAll('.whitelist-domain');
  return Array.from(items).map(el => el.textContent.trim());
}

// ─── Clear Storage Dialog ─────────────────────────────────────────

/**
 * Estimate byte size of a value by JSON-serialising it.
 */
function estimateBytes(value) {
  if (value === undefined || value === null) return 0;
  return new Blob([JSON.stringify(value)]).size;
}

/**
 * Format bytes into a human-friendly string.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setupClearStorage() {
  const openBtn = document.getElementById('clear-storage-btn');
  const dialog = document.getElementById('clear-storage-dialog');
  const cancelBtn = document.getElementById('clear-storage-cancel');
  const confirmBtn = document.getElementById('clear-storage-confirm');
  if (!openBtn || !dialog) return;

  openBtn.addEventListener('click', async () => {
    await populateStorageSizes();
    dialog.showModal();
  });

  cancelBtn?.addEventListener('click', () => dialog.close());

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // Close on Escape (native dialog behaviour, but make sure)
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    dialog.close();
  });

  confirmBtn?.addEventListener('click', async () => {
    const checked = dialog.querySelectorAll('input[name="clear-cat"]:checked');
    const keys = Array.from(checked).map(cb => cb.value);
    if (keys.length === 0) return;

    // Build the removal payload
    const removals = [];
    for (const key of keys) {
      if (key === 'config') {
        removals.push('config');
      } else {
        removals.push(key);
      }
    }

    await chrome.storage.local.remove(removals);

    // If config was cleared, preserve the supporter activation flag
    // so grandfathered supporters keep AI access across code rotations
    if (keys.includes('config')) {
      await chrome.storage.local.set({ config: { aiActivated: aiActivatedFlag } });
      location.reload();
      return;
    }

    // Refresh sizes and show confirmation
    await populateStorageSizes();
    confirmBtn.textContent = 'Cleared!';
    confirmBtn.disabled = true;
    setTimeout(() => {
      confirmBtn.textContent = 'Clear Selected';
      confirmBtn.disabled = false;
      dialog.close();
    }, 1200);
  });
}

/**
 * Show/hide the Zeroize button based on debug mode.
 */
function updateZeroizeVisibility(debugEnabled) {
  const btn = document.getElementById('zeroize-btn');
  if (btn) btn.hidden = !debugEnabled;
}

/**
 * Set up the Zeroize button — a true factory reset that wipes everything,
 * including the aiActivated flag. Only visible in debug mode.
 */
function setupZeroize() {
  const btn = document.getElementById('zeroize-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const confirmed = confirm(
      'ZEROIZE: This will erase ALL Closure data including your supporter activation. ' +
      'You will need to re-enter a valid supporter code to use AI features.\n\n' +
      'This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    await chrome.storage.local.clear();
    aiActivatedFlag = false;

    // Force AI toggle off so UI state is consistent before reload
    const aiBtn = document.getElementById('enable-ai');
    if (aiBtn) aiBtn.setAttribute('aria-checked', 'false');
    applyAiDisabledState(true);

    location.reload();
  });
}

async function populateStorageSizes() {
  const data = await chrome.storage.local.get(null);
  const categories = {
    archived: data.archived ?? [],
    swept: data.swept ?? [],
    stats: data.stats ?? {},
    config: data.config ?? {},
  };

  let totalBytes = 0;
  for (const [key, value] of Object.entries(categories)) {
    const bytes = estimateBytes(value);
    totalBytes += bytes;
    const el = document.getElementById(`size-${key}`);
    if (el) {
      const count = Array.isArray(value) ? ` (${value.length} entries)` : '';
      el.textContent = `${formatBytes(bytes)}${count}`;
    }
  }

  // Account for other keys (schema_version, snoozed, etc.)
  const otherKeys = Object.keys(data).filter(k => !categories.hasOwnProperty(k));
  for (const k of otherKeys) {
    totalBytes += estimateBytes(data[k]);
  }

  const totalEl = document.getElementById('storage-total');
  if (totalEl) totalEl.textContent = `Total storage used: ${formatBytes(totalBytes)}`;
}

// ─── Incognito Detection ─────────────────────────────────────────

async function checkIncognito() {
  try {
    const self = await chrome.management.getSelf();
    const section = document.getElementById('incognito-section');
    if (section && self.enabled && self.installType !== 'development') {
      // Check if incognito is allowed (we can't directly detect this,
      // but if we're running in an incognito context, warn)
      if (chrome.extension?.inIncognitoContext) {
        section.hidden = false;
      }
    }
  } catch {
    // management API may not be available — silently skip
  }
}
