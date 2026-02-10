# Copilot Instructions — Tab-Shame Absolution Engine ("Closure")

## Project Overview

**Closure** is a Chromium extension (Manifest V3) that combats "browser guilt" by automatically tidying tabs and archiving idle ones with local AI summaries. It is privacy-first — no data ever leaves the device. The business model is donation-based ("gratitude"), never paywalled.

Core philosophy: this is a **Digital Archivist** that provides emotional relief, not just tab management. Every feature should reinforce the feeling that "nothing is lost."

## Tech Stack & Constraints

- **Platform:** Chromium Extension, Manifest V3.
- **Language:** JavaScript (ES6+). No TypeScript, no build step unless explicitly added later.
- **AI Engine:** Chrome built-in `window.ai` (Gemini Nano). Always implement a graceful fallback for when `window.ai` is unavailable or reports insufficient resources.
- **Storage:** `chrome.storage.local` exclusively. Never use `localStorage`, IndexedDB, or any remote storage.
- **Permissions:** `tabs`, `tabGroups`, `storage`, `alarms`, `notifications`, `scripting`. Request heavier permissions (`scripting`, full `tabs`) only when the user enables AI/archival features.
- **Privacy:** Zero data exfiltration. No analytics, no telemetry, no remote calls of any kind. Every code path must be auditable for this guarantee.

## Architecture Conventions

### File & Folder Structure

Follow standard Manifest V3 extension layout:

```
manifest.json
background.js          # Service worker: alarms, tab events, orchestration
content.js             # Content script: page text extraction, error detection
popup/
  popup.html
  popup.js
  popup.css
digest/
  digest.html          # Sunday Digest / "This Week's Curiosity" dashboard
  digest.js
  digest.css
settings/
  settings.html
  settings.js
  settings.css
onboarding/
  onboarding.html      # First-run permission justification screen
  onboarding.js
  onboarding.css
icons/                 # Extension icons (16, 48, 128 px)
```

### Service Worker (`background.js`)

- All tab monitoring, alarm scheduling, tab grouping, and tab closing logic lives here.
- Use `chrome.alarms` for periodic sweeps (Dead End Sweeper every 60 min, idle-tab checks).
- Never use `setInterval`/`setTimeout` for persistence — service workers are ephemeral in MV3.
- Keep the service worker lean; delegate page-content work to content scripts via `chrome.scripting.executeScript`.

### Content Scripts

- Used to extract page text, detect error states, read `performance.getEntriesByType('navigation')`, and inject the "Stay of Execution" overlay.
- Must be injected on-demand via `chrome.scripting.executeScript`, not declared statically in the manifest, to support permission-gating.

### Storage Schema

Use a consistent, versioned schema in `chrome.storage.local`:

```js
{
  "schema_version": 1,
  "config": {
    "groupThreshold": 3,          // 3–10, default 3
    "idleThresholdHours": 24,     // 4–168, default 24
    "whitelist": [],               // array of domain strings
    "enableThematicClustering": false,
    "highContrastMode": false
  },
  "archived": [
    {
      "url": "",
      "title": "",
      "favicon": "",
      "timestamp": 0,
      "summary": "",              // AI bullets or fallback text
      "summaryType": "ai|fallback",
      "domain": ""
    }
  ],
  "swept": [
    { "url": "", "title": "", "timestamp": 0, "reason": "" }
  ],
  "stats": {
    "tabsTidiedThisWeek": 0,
    "ramSavedEstimate": 0
  }
}
```

Always migrate data forward when bumping `schema_version`.

## Feature Implementation Guidelines

### 1. Clean Slate Automator (Auto-Grouping)

- Trigger on `chrome.tabs.onCreated` / `chrome.tabs.onUpdated` when a new tab from the same root domain hits the configured threshold.
- Extract root domain with `new URL(tab.url).hostname` — strip `www.` prefix for grouping.
- Use `chrome.tabGroups` API for creation, naming (UPPERCASED domain), and color assignment.
- Maintain a deterministic domain → color mapping so colors are stable across sessions. Use the 9 available `chrome.tabGroups.Color` values and cycle.
- Groups are created already collapsed — the whole point is reducing visual clutter immediately.
- Never group pinned tabs.

### 2. Dead End Sweeper (Error Management)

- Runs via a recurring `chrome.alarms` alarm every 60 minutes.
- Detection criteria (check in order):
  1. Content script reads `performance.getEntriesByType('navigation')[0].responseStatus` for 4xx/5xx.
  2. Tab title or body text matches error patterns: `404`, `500`, `502`, `503`, `Timed Out`, `Site Can't Be Reached`, `ERR_`, `DNS_PROBE`, `This site can't be reached`, `Server Error`, `Page Not Found`.
  3. Tab stuck with `status !== 'complete'` for > 1 hour.
- Exclude whitelisted domains and pinned tabs.
- Before closing: log to `swept` array in storage with URL, title, timestamp, and reason.
- After sweep: update badge text with count of swept tabs (e.g., `"+3"`). Clear badge after 30 seconds.

### 3. Graceful Exit (AI Archival)

- Identify idle tabs: compare `tab.lastAccessed` against configured threshold.
- Content script extracts: page title, meta description, first 500 chars of `document.body.innerText`, favicon URL.
- AI summarization flow:
  1. Check `window.ai` availability (via content script or offscreen document).
  2. If available: prompt exactly — `"Summarize this page in 3 bullet points (total under 100 words), preserving key facts, numbers, dates, action items, and the user's likely intent for visiting."`
  3. If unavailable or errors: save title + URL + favicon + first 500 chars of visible text as fallback. Set `summaryType: "fallback"`.
  4. If `window.ai` reports insufficient resources: skip AI silently, use fallback.
- "Stay of Execution" overlay: inject via content script 10 minutes before archival. Show tab favicon pulse + overlay with "Keep this open?" / "Yes" / "Snooze 24h". If no interaction, proceed with archival.
- After archival: fire a `chrome.notifications.create` notification — `"Moved [Page Title] to your Sunday Digest. Summary saved."`
- Never archive pinned tabs or tabs playing media (`tab.audible === true` or `tab.mutedInfo.muted === false` while audible).

### 4. Sunday Digest

- Full-page HTML dashboard, opened from popup or optionally as new-tab override.
- Default view: archived tabs grouped by domain, sorted by recency within each group.
- "Cluster by Theme" button (if enabled in config): re-processes summaries with `window.ai` prompt — `"Group these summaries into thematic clusters and suggest short cluster titles."` Hide button if `window.ai` unavailable.
- Each entry shows: favicon, title (linked to URL), summary bullets, timestamp.
- "Restore Group" reopens all tabs in a domain/cluster group. "Restore Single Tab" reopens one.
- Restored entries remain in history but are visually marked as restored.
- Donation trigger at bottom: dynamic stat — `"You explored {n} topics this week. Your browser stayed clean. [Buy Me an Energy Drink]"`

### 5. Safety Net

- **Hard rules (never override):**
  - Pinned tabs are immune to grouping, sweeping, and archival.
  - Tabs with `tab.audible === true` are immune.
- Whitelist stored in `config.whitelist` — array of domain strings. Match against `new URL(tab.url).hostname`.
- All features must work across multiple windows.
- Incognito: extension disabled by default. If user enables, show a warning in settings.

### 6. Zen Popup

- Status ring: compute "browser health" from open tab count — green (≤15), yellow (16–30), red (>30). Thresholds are fine to hardcode.
- "Archive Idle Tabs Now" button: triggers Graceful Exit for all tabs idle > 4 hours (hard-coded for nuclear option).
- Impact stats: pull from `stats` in storage. Estimate RAM saved at ~50 MB per closed tab (rough heuristic).
- Post-nuclear toast (if >20 tabs archived): `"Ah, silence—and you just reclaimed ~{ram} RAM. Enjoy the focus. [Support Us]"`

## Coding Standards

- Use `async/await` over raw Promise chains.
- Prefer `const` over `let`; never use `var`.
- All Chrome API calls must handle errors: check `chrome.runtime.lastError` or catch promise rejections.
- Use early returns to reduce nesting.
- Comment "why," not "what." Complex logic should have a brief docblock.
- No external dependencies or CDNs. Everything runs from extension bundle.
- Functions should be small and single-purpose. If a function exceeds ~40 lines, consider splitting.

## Accessibility

- All interactive elements must be keyboard-navigable with visible focus indicators.
- Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<section>`), ARIA labels where needed.
- Color-coded tab groups must meet WCAG AA contrast (4.5:1 for text).
- Settings includes a high-contrast mode toggle.
- Screen-reader-friendly: all images have `alt` text, status updates use `aria-live` regions.

## Testing Notes

- Test with 50+ open tabs across multiple windows.
- Test with `window.ai` unavailable — all features must degrade gracefully.
- Test that pinned tabs and audible tabs are never touched.
- Test whitelisted domains are fully excluded.
- Verify no network requests are made (privacy guarantee).
- Test service worker lifecycle — alarms must survive worker termination and restart.

## Donation Integration

- Donation links point to a configurable URL (default: `https://ko-fi.com/krich11`).
- Never block features behind donation. Never nag.
- Donation prompts appear only:
  1. Bottom of Sunday Digest.
  2. Post-nuclear / large-sweep toast (>20 tabs).
- Copy always includes: `"This runs 100% locally. Support the code that keeps your privacy safe."`
