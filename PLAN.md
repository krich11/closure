# Closure Plan — v1.7.2

## Goal

Implement a privacy-first Chromium extension (MV3) that tidies tabs, archives idle ones with local AI summaries, and provides a calm Sunday Digest. No network calls. All data stays on-device in `chrome.storage.local`.

## Current State

Phase 3 (The Soul) is complete:
- ✅ Storage schema initialization + migration scaffold
- ✅ Clean Slate Automator (auto-grouping) with deterministic colors + immediate collapse
- ✅ Safety net: pinned/audible immunity + whitelist enforcement
- ✅ Zen Popup with status ring, tab count, nuclear archive, settings link
- ✅ Sunday Digest with domain grouping, recency sorting, thematic clustering, restore
- ✅ Dead End Sweeper (error detection + sweep)
- ✅ Content script (`content.js`)
- ✅ Graceful Exit (AI archival + Stay of Execution + notifications)
- ✅ Settings page (thresholds, whitelist, high-contrast, AI status)
- ✅ Onboarding page (4-step first-run experience)
- ✅ Tailwind CSS build pipeline (popup, digest, settings, onboarding)
- ✅ Gratitude donation footer + post-nuclear toasts
- ✅ Playwright test suite (7 spec files, all passing)

## Delivery Phases

### Phase 1: The Mechanic (Remaining Work)

- [x] Create `content.js` — on-demand script for page extraction + error detection.
- [x] Dead End Sweeper: recurring alarm (every 60 min), content script error detection, sweep logic, badge update.
- [x] Wire `chrome.alarms.create('dead-end-sweeper', { periodInMinutes: 60 })` on install.
- [x] Implement error pattern matching (HTTP status, title patterns, stuck tabs).
- [x] Log swept tabs to `swept[]` array before closing.
- [x] Badge text update (`+N`) with 30-second auto-clear.

### Phase 2: The Brain

- [x] Graceful Exit: idle tab detection comparing `tab.lastAccessed` vs threshold.
- [x] Content script extraction: title, meta description, first 500 chars, favicon URL.
- [x] AI summarization via `window.ai` with exact prompt. Fallback to metadata-only.
- [x] Stay of Execution overlay: inject 10 min before archival via content script.
- [x] Archival flow: save to `archived[]`, close tab, fire notification.
- [x] Nuclear archive button: handler in popup.js for all tabs idle > 4h.
- [x] Stats updates: increment `tabsTidiedThisWeek`, add ~50 MB per tab to `ramSavedEstimate`.
- [x] Post-nuclear toast if >20 tabs archived.

### Phase 3: The Soul

- [x] Settings page (`settings/`) with configurable thresholds, whitelist management, high-contrast toggle.
- [x] Onboarding page (`onboarding/`) with permission justification.
- [x] Sunday Digest: optional thematic clustering via `window.ai`.
- [x] Digest: sort by recency within groups.
- [x] Donation trigger toasts in popup after large sweeps.
- [x] Accessibility polish: focus indicators, ARIA labels audit, high-contrast mode.
- [x] Edge case hardening: multiple windows, incognito warning, low-end hardware.

## Directory Structure

Current and target structure (MV3 standard):

```
manifest.json
background.js          # Service worker: alarms, tab events, orchestration
content.js             # Injected on-demand for extraction + overlays
popup/
  popup.html
  popup.js
  popup.css
digest/
  digest.html          # Sunday Digest dashboard
  digest.js
  digest.css
settings/
  settings.html        # (Phase 3)
  settings.js
  settings.css
onboarding/
  onboarding.html      # (Phase 3)
  onboarding.js
  onboarding.css
icons/
  icon-16.png
  icon-48.png
  icon-128.png
playwright.config.js
package.json
tests/
  fixtures.js
  extension-init.spec.js
  privacy.spec.js
  safety-net.spec.js
  storage.spec.js
  popup.spec.js
  dead-end-sweeper.spec.js
```

Files not yet created: none — all pages implemented.

## Manifest V3 Permission Map

| Permission | Why it is needed | Scope | When requested |
| --- | --- | --- | --- |
| `tabs` | Read tab metadata (`lastAccessed`, `audible`, `pinned`, URLs), close/archive tabs, detect activity for grouping and sweeps | All windows | Always (core functionality) |
| `tabGroups` | Create, update, and collapse tab groups for Clean Slate Automator | All windows | Always |
| `storage` | Persist config, archived entries, sweep history, and stats | Local only (`chrome.storage.local`) | Always |
| `alarms` | Schedule periodic sweeps (60 min), idle checks | Service worker | Always |
| `notifications` | Notify when tabs are archived to Sunday Digest | User-visible | Always (passive only) |
| `scripting` | Inject content scripts for extraction, error detection, Stay of Execution overlay | Per-tab on demand | Always (gated by feature activation) |

No `host_permissions` — content scripts are injected programmatically via `chrome.scripting.executeScript`.

## Storage Schema (v1)

```js
{
  "schema_version": 1,
  "config": {
    "groupThreshold": 3,          // 3–10, default 3
    "idleThresholdHours": 24,     // 4–168, default 24
    "whitelist": [],               // array of domain strings
    "enableThematicClustering": false,
    "enableTopicGrouping": false,
    "topicGroupingIntervalMinutes": 120,
    "topicGroupingOvernightOnly": false,
    "highContrastMode": false
  },
  "archived": [
    {
      "url": "",
      "title": "",
      "favicon": "",
      "timestamp": 0,             // Date.now() at archival
      "summary": "",              // AI bullets or fallback text
      "summaryType": "ai|fallback",
      "domain": ""
    }
  ],
  "swept": [
    {
      "url": "",
      "title": "",
      "timestamp": 0,
      "reason": ""                // e.g. "HTTP 404", "Title match: ERR_CONNECTION_REFUSED"
    }
  ],
  "stats": {
    "tabsTidiedThisWeek": 0,
    "ramSavedEstimate": 0         // in MB, ~50 MB per closed tab
  }
}
```

## Background Service Worker Architecture

```
background.js
├── Constants: DEFAULT_CONFIG, DEFAULT_STORAGE, GROUP_COLORS, ERROR_PATTERNS
├── Helpers
│   ├── getRootDomain(url)           — extract grouping domain
│   ├── domainToColorIndex(domain)   — djb2 hash → color index
│   └── isDomainWhitelisted(domain)  — check config.whitelist
├── Clean Slate Automator
│   ├── evaluateAutoGroup(tab)       — threshold check, group/create
│   ├── findExistingGroup(domain)    — query existing tab groups
│   ├── scheduleCollapseAlarm(id, h) — one-shot collapse alarm
│   └── handleCollapseAlarm(name)    — collapse on alarm fire
├── Dead End Sweeper
│   ├── runDeadEndSweep()            — scan all tabs for errors
│   ├── detectTabError(tab)          — title pattern + content script
│   ├── sweepTab(tab, reason)        — log + close + stats update
│   └── updateBadge(count)           — show "+N", auto-clear 30s
├── Graceful Exit (Phase 2)
│   ├── runIdleTabCheck()            — scan for idle tabs
│   ├── extractPageContent(tabId)    — inject content script
│   ├── summarizeWithAI(content)     — window.ai or fallback
│   ├── archiveTab(tab, summary)     — save + close + notify
│   └── injectStayOfExecution(tabId) — overlay before archival
├── Event Listeners (synchronous registration)
│   ├── chrome.runtime.onInstalled   — init storage, create alarms
│   ├── chrome.tabs.onUpdated        — evaluateAutoGroup
│   ├── chrome.alarms.onAlarm        — route to feature handlers
│   └── chrome.runtime.onMessage     — content script responses
└── Nuclear Archive (Phase 2)
    └── handleNuclearArchive()       — archive all idle > 4h
```

## Race Condition Analysis: Graceful Exit

### Identified Risks

1. **Concurrent archival of multiple tabs**: If `runIdleTabCheck()` fires while a previous run is still in progress, the same tab could be archived twice.
   - **Mitigation**: Use an in-memory `Set` of tab IDs currently being processed. Check before starting, add on start, remove on completion.

2. **Tab closed between detection and archival**: User closes a tab between identification and archive attempt.
   - **Mitigation**: Wrap `chrome.tabs.get()` and `chrome.tabs.remove()` in try/catch. Skip silently if tab no longer exists.

3. **Content script injection into navigating tab**: Tab navigates away during injection/extraction.
   - **Mitigation**: Catch `chrome.scripting.executeScript` errors. Fall back to metadata-only summary.

4. **Stay of Execution + user interaction race**: User clicks "Keep" while the archival alarm fires.
   - **Mitigation**: Snooze sends `chrome.runtime.sendMessage({ action: 'snooze', tabId })`. Archival checks a `snoozed` map before closing. Use alarm-based snooze to survive worker restart.

5. **Storage write conflicts**: Multiple sweeps/archivals writing to `archived[]`/`swept[]` simultaneously.
   - **Mitigation**: Process tabs sequentially with `for...of` + `await`. Chrome's storage serializes writes, but rapid concurrent reads see stale data.

6. **Service worker termination mid-archival**: Worker killed between saving summary and closing tab.
   - **Mitigation**: Save archived entry to storage *before* closing the tab.

## Constraints (Non-Negotiable)

- Zero network requests. No fetch/XHR to external domains.
- `window.ai` only; fall back to local metadata if unavailable.
- Pinned and audible tabs are never touched.
- Whitelisted domains are immune to all automation.
- All features work across multiple windows.
- Incognito disabled by default; show warning if enabled.
- No TypeScript, no build step, no external dependencies.
- `async/await` over raw Promises. `const` over `let`. Never `var`.
- Functions under ~40 lines, single-purpose.
- No `setInterval`/`setTimeout` for persistence — use `chrome.alarms`.
