#!/usr/bin/env node
/**
 * Closure — Settings page (settings.js)
 * @version 1.1.0
 *
 * Loads config from chrome.storage.local, binds controls,
 * auto-saves on change. No network calls.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const { config } = await chrome.storage.local.get('config');
  const cfg = config || {};

  bindRangeSlider('group-threshold', 'group-threshold-value', cfg.groupThreshold ?? 3, formatInt);
  bindRangeSlider('collapse-hours', 'collapse-hours-value', cfg.collapseAfterHours ?? 3, v => `${v}h`);
  bindRangeSlider('idle-threshold', 'idle-threshold-value', cfg.idleThresholdHours ?? 24, v => `${v}h`);

  bindToggle('enable-clustering', cfg.enableThematicClustering ?? false);
  bindToggle('high-contrast', cfg.highContrastMode ?? false);

  applyHighContrast(cfg.highContrastMode ?? false);
  checkAiAvailability();
  loadWhitelist(cfg.whitelist ?? []);
  setupWhitelistInput();
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

    saveConfig();
  });
}

// ─── Save Config ──────────────────────────────────────────────────

async function saveConfig() {
  const newConfig = {
    groupThreshold: parseInt(document.getElementById('group-threshold')?.value, 10) || 3,
    collapseAfterHours: parseInt(document.getElementById('collapse-hours')?.value, 10) || 3,
    idleThresholdHours: parseInt(document.getElementById('idle-threshold')?.value, 10) || 24,
    enableThematicClustering: document.getElementById('enable-clustering')?.getAttribute('aria-checked') === 'true',
    highContrastMode: document.getElementById('high-contrast')?.getAttribute('aria-checked') === 'true',
    whitelist: getWhitelistFromDOM(),
  };

  await chrome.storage.local.set({ config: newConfig });
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
  if (!statusEl) return;

  try {
    if (typeof window.ai !== 'undefined' && window.ai?.languageModel) {
      const capabilities = await window.ai.languageModel.capabilities();
      if (capabilities.available === 'readily') {
        statusEl.textContent = 'On-device AI is available and ready.';
        statusEl.className = 'ai-status ai-status--available';
      } else if (capabilities.available === 'after-download') {
        statusEl.textContent = 'On-device AI model needs to download first.';
        statusEl.className = 'ai-status ai-status--pending';
      } else {
        statusEl.textContent = 'On-device AI is not available. Summaries will use fallback text.';
        statusEl.className = 'ai-status ai-status--unavailable';
      }
    } else {
      statusEl.textContent = 'On-device AI is not available in this browser. Summaries will use fallback text.';
      statusEl.className = 'ai-status ai-status--unavailable';
    }
  } catch {
    statusEl.textContent = 'Could not check AI status. Summaries will use fallback text.';
    statusEl.className = 'ai-status ai-status--unavailable';
  }
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
  li.innerHTML = `
    <span class="whitelist-domain">${domain}</span>
    <button class="whitelist-remove" type="button" aria-label="Remove ${domain} from whitelist">&times;</button>
  `;

  li.querySelector('.whitelist-remove').addEventListener('click', () => {
    li.remove();
    const remaining = document.querySelectorAll('.whitelist-item');
    if (remaining.length === 0 && emptyEl) emptyEl.hidden = false;
    saveConfig();
  });

  listEl.appendChild(li);
}

function setupWhitelistInput() {
  const input = document.getElementById('whitelist-input');
  const addBtn = document.getElementById('whitelist-add');
  if (!input || !addBtn) return;

  const addDomain = () => {
    const raw = input.value.trim().toLowerCase();
    if (!raw) return;

    // Strip protocol if pasted
    const domain = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!domain) return;

    // Avoid duplicates
    const existing = getWhitelistFromDOM();
    if (existing.includes(domain)) {
      input.value = '';
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
