# Closure Plan

## Goal

Implement a privacy-first Chromium extension (MV3) that tidies tabs, archives idle ones with local AI summaries, and provides a calm Sunday Digest. No network calls. All data stays on-device in `chrome.storage.local`.

## Delivery Phases

### Phase 1: The Mechanic

- Storage schema initialization + migration scaffold.
- Clean Slate Automator (auto-grouping) with deterministic colors + auto-collapse.
- Dead End Sweeper with robust error detection via content scripts.
- Safety net: pinned/audible immunity + whitelist enforcement.

### Phase 2: The Brain

- Graceful Exit archival flow with `window.ai` summary + fallback.
- Stay of Execution overlay (10 minutes before archival) with snooze.
- Notifications on archival, stats updates.

### Phase 3: The Soul

- Sunday Digest UI (grouped by domain, restore group/single).
- Optional thematic clustering using local AI.
- Zen Popup + donation trigger toasts.
- Onboarding + permission gating + accessibility polish.

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
  settings.html
  settings.js
  settings.css
onboarding/
  onboarding.html      # Permission justification screen
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
```

Notes:
- `content.js`, `digest/`, `settings/`, `onboarding/` are planned and not yet implemented.
- `node_modules/`, `test-results/`, and `playwright-report/` are local-only artifacts.

## Manifest V3 Permission Map

| Permission | Why it is needed | Scope | Notes |
| --- | --- | --- | --- |
| `tabs` | Read tab metadata (`lastAccessed`, `audible`, `pinned`, URLs), close/archive tabs, detect activity for grouping and sweeps | All windows | Must be permission-gated when AI/archival features are enabled |
| `tabGroups` | Create, update, and collapse tab groups for Clean Slate Automator | All windows | Colors and labels assigned per domain |
| `storage` | Persist config, archived entries, sweep history, and stats | Local only | `chrome.storage.local` exclusively |
| `alarms` | Schedule periodic sweeps and auto-collapse events | Service worker | Required because MV3 workers are ephemeral |
| `notifications` | Notify when tabs are archived to Sunday Digest | User-visible | Passive notifications only |
| `scripting` | Inject content scripts for extraction, error detection, and Stay of Execution overlay | Per-tab | Must be permission-gated for AI/archival features |

## Constraints (Non-Negotiable)

- Zero network requests. No fetch/XHR to external domains.
- `window.ai` only; fall back to local metadata if unavailable.
- Pinned and audible tabs are never touched.
- Whitelisted domains are immune to all automation.
- All features work across multiple windows.
- Incognito disabled by default; show warning if enabled.
