# Chrome Web Store — Permission Justifications

Use these when filling out the CWS Developer Dashboard "Justify permissions" section.

---

### `tabs`
Read tab URLs, titles, and last-accessed timestamps to enable domain-based auto-grouping, idle tab detection for archival, and dead-end sweeping of error pages. No tab content is read through this permission — only metadata.

### `tabGroups`
Create, name, color, and collapse tab groups as part of the Clean Slate Automator feature, which automatically organizes same-domain tabs into labeled groups to reduce tab bar clutter.

### `storage`
Persist user configuration (grouping threshold, idle timeout, whitelist), archived tab records with summaries, swept error tab logs, and usage statistics. All data is stored locally via chrome.storage.local and never transmitted.

### `alarms`
Schedule periodic background tasks: the Dead End Sweeper (every 60 minutes) scans for broken/error tabs, and idle tab checks identify tabs for archival. Alarms are required because Manifest V3 service workers cannot use setInterval/setTimeout for persistent scheduling.

### `notifications`
Display a notification when a tab is archived ("Moved [Page Title] to your Sunday Digest. Summary saved.") so the user is always aware when tabs are closed on their behalf.

### `offscreen`
Create an offscreen document to run Chrome's built-in on-device Gemini Nano AI model for generating tab summaries. The offscreen document provides the DOM context that window.ai / LanguageModel requires, which isn't available in the service worker.

### `scripting` (optional — requested at runtime)
Inject a content script to extract page text (title, meta description, first 500 characters of body text) for more accurate AI-generated summaries. Only requested when the user explicitly enables AI archival features. The content script makes no network requests and only reads DOM content.

### `<all_urls>` (optional host permission — requested at runtime)
Required in conjunction with the `scripting` permission to allow content script injection on any webpage the user has open. Only requested when the user enables AI-powered tab archival. Without this, the content script cannot access page text for summarization.

---

## Category

**Productivity**

## Single Purpose Description

Closure organizes browser tabs by automatically grouping same-domain tabs, detecting and closing broken pages, and archiving idle tabs with on-device AI summaries — all 100% locally with zero data collection.
