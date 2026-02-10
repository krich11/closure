Ken,

Here is the revised functional specification (Version 1.1.0) with incorporated feedback: added configurability where sensible, improved detection robustness, enhanced AI fallbacks and prompts, optional thematic clustering, single-tab restore, permission onboarding mitigation, edge-case handling, accessibility notes, and one additional donation trigger. The core vision and structure remain intact.

---

# Functional Description Document: The "Tab-Shame" Absolution Engine

**Version:** 1.6.1  
**Date:** February 9, 2026  
**Confidentiality:** Internal Use Only  
**Changes from 1.0.0:** Added configurability, improved error detection, refined AI handling and prompts, optional thematic clustering, single-tab restore, permission onboarding flow, edge-case coverage, accessibility requirements, and one additional donation trigger.

---

## 1. Executive Summary & Product Vision

### The Problem: "Browser Guilt"

Modern browser usage is characterized by "tab hoarding." Users keep tabs open not because they are currently using them, but because they are afraid of losing the information or the context associated with them. This leads to:

* **Cognitive Load:** Visual clutter causing anxiety and "brain fog."
* **Performance Degradation:** High RAM usage slowing down the machine.
* **Emotional Weight:** A growing list of "should-dos" that turns the browser into a source of guilt rather than a tool.

### The Solution: "Absolution as a Service"

The **Tab-Shame Absolution Engine** is not just a tab manager; it is a "Digital Archivist." It uses local, privacy-first AI to aggressively tidy the browser environment while providing the user with the psychological safety that "nothing is lost."

### The Business Model: Donation-Based "Gratitude"

Unlike competitors (OneTab, Workona) that focus on utility/productivity, this extension focuses on **emotional relief**. We do not charge a subscription. We rely on the "Value Exchange" model: users donate when they feel a tangible sense of relief or "absolution" from their digital clutter.

---

## 2. Core Feature Set

### 2.1 The "Clean Slate" Automator (Auto-Grouping)

**Intent:** To reduce visual noise without user intervention.  
**Logic:**

* **Trigger:** When the user opens a tab that brings the count from the same root domain (e.g., `github.com`, `amazon.com`) to the configured threshold (default 3, user-configurable 3–10).
* **Action:** Automatically groups these tabs into a Chrome Tab Group.
* **Naming Convention:** The group is named after the domain (e.g., "GITHUB", "SHOPPING").
* **Color Coding:** Assigns a distinct color per domain to aid visual scanning and accessibility (ensure WCAG AA contrast).
* **Behavior:** Groups automatically collapse if not interacted with for 3 hours (configurable).

### 2.2 The "Dead End" Sweeper (Error Management)

**Intent:** To remove useless "dead weight" that the user is too lazy to close.  
**Logic:**

* **Monitor:** Use `chrome.tabs.onUpdated` to detect load completion. Every 60 minutes, scan tabs for error states.
* **Criteria:** 
  - HTTP error status (via content script reading `performance.getEntriesByType('navigation')[0].responseStatus` if available).
  - Titles or page content containing common error indicators (`404`, `500`, `Timed Out`, `Site Can't Be Reached`, etc.).
  - Tabs stuck in non-complete loading state for > 1 hour.
  - Exclude intentional long-loading tabs (e.g., monitoring dashboards) via whitelist.
* **Action:**
  1. Logs the URL in a "Swept" history (safety net).
  2. Closes the tab immediately.
* **User Feedback:** Subtle badge count update on the extension icon (e.g., "+3" indicating 3 dead tabs swept).

### 2.3 The "Graceful Exit" (AI Archival)

**Intent:** The core "absolution" mechanic. Allows users to close tabs without FOMO.  
**Logic:**

* **Trigger:** A tab has been idle (`lastAccessed`) for the configured threshold (default > 24 hours, user-configurable 4–168 hours).
* **AI Processing:**
  - Grab page text/metadata via content script.
  - If `window.ai` (Gemini Nano) is available: prompt → "Summarize this page in 3 bullet points (total under 100 words), preserving key facts, numbers, dates, action items, and the user's likely intent for visiting."
  - Fallback (no local AI): Save title, URL, favicon, and first 500 characters of visible text as a minimal readable summary.
* **Action:**
  1. Saves URL, Title, Timestamp, and AI/minimal summary to `chrome.storage.local`.
  2. Closes the tab.
* **Notification:** Passive notification: *"Moved [Page Title] to your Sunday Digest. Summary saved."*

### 2.4 The "Sunday Digest" (Weekly Ritual)

**Intent:** To turn the "graveyard of tabs" into a "magazine of curiosity," validating the user's interests.  
**Interface:** Beautiful, clean HTML dashboard (opened via popup or new tab override option).  
**Content:**

* **"This Week's Curiosity":** Grouped list of all archived tabs from the last 7 days (default grouping by domain; optional "Cluster by Theme" button that re-processes summaries locally with `window.ai` prompt: "Group these summaries into thematic clusters and suggest short cluster titles").
* **Visuals:** High-quality favicons and the 3-bullet (or fallback) summary for each entry.
* **Actions:** 
  - "Restore Group" button to reopen clusters.
  - "Restore Single Tab" for individual entries.
* **Donation Trigger:** Bottom of page → *"You explored 45 topics this week. Your browser stayed clean. [Buy the Dev a Coffee]"*

### 2.5 The "Safety Net" (Exceptions & Whitelisting)

**Intent:** To prevent frustration by never closing "mission-critical" tabs.  
**Logic:**

* **Hard Rules:** 
  - Never close or group a Pinned Tab.
  - Never close a tab currently playing media (YouTube, Spotify, etc.).
* **User Whitelist:** Settings UI to add domains (e.g., `localhost`, `jira.company.com`) immune to all automation.
* **"Stay of Execution":** 10 minutes before Graceful Exit, tab favicon pulses and small non-intrusive overlay asks: *"Keep this open?"* (with "Yes" / "Snooze 24h" options).

**Edge Cases Covered:**
* Multiple windows: All features work across windows.
* Incognito mode: Extension disabled by default (user can override in settings with warning).
* Low-end hardware: Lightweight alarms and monitoring; skip AI summarization if `window.ai` reports insufficient resources.

---

## 3. User Experience (UX) & Interface

### 3.1 The "Zen" Popup

Extension icon click shows:

* **Status Ring:** Visual "Browser Health" indicator (Green = Low Clutter, Red = High Clutter).
* **Nuclear Option:** Prominent **"Archive Idle Tabs Now"** button (triggers Graceful Exit for all tabs idle > 4h).
* **Impact Stats:** "142 tabs tidied this week. 450MB RAM saved." (updated live).
* **Additional Donation Trigger:** After Nuclear Option use or large sweep (>20 tabs), tasteful toast: *"Ah, silence—and you just reclaimed ~1.2 GB RAM. Enjoy the focus. [Support Us]"*

### 3.2 The Donation Mechanism

* **Philosophy:** Nag-free. Never block features.
* **Placement:**
  - Bottom of Sunday Digest.
  - Post-Nuclear / large sweep toast.
  - All messages: *"This runs 100% locally. Support the code that keeps your privacy safe."*

### 3.3 Accessibility

* Color-coded groups meet WCAG AA contrast ratios.
* All UI elements keyboard-navigable and screen-reader labeled.
* High-contrast mode toggle in settings.

---

## 4. Technical Architecture

### 4.1 Tech Stack

* **Platform:** Chromium Extension (Manifest V3).
* **Language:** JavaScript (ES6+).
* **AI Engine:** Chrome built-in `window.ai` (Gemini Nano); graceful fallback to metadata-only.
* **Storage:** `chrome.storage.local` exclusively.

### 4.2 Permissions Required

* `tabs`, `tabGroups`, `storage`, `alarms`, `notifications`, `scripting`.

**Onboarding Mitigation:**  
First-run experience includes a clear permission justification screen explaining why each permission is needed and emphasizing zero data exfiltration. Request heavier permissions (`scripting`, full `tabs`) only when user enables AI/archival features.

### 4.3 Privacy & Security

* **Zero Data Exfiltration:** No URLs, history, or summaries ever leave the device.
* **Local Processing Only.**
* **Transparency Statement (About page):** *"We do not have a server. We cannot see your tabs even if we wanted to."*

---

## 5. Development Roadmap (MVP)

### Phase 1: The Mechanic (Weeks 1-2)

* Implement tab monitoring, alarms, configurable auto-grouper.
* Build robust Dead End Sweeper with content-script status detection.

### Phase 2: The Brain (Weeks 3-4)

* Integrate `window.ai` with refined prompt and robust fallback.
* Implement storage schema, configurable Graceful Exit, Safety Net logic.

### Phase 3: The Soul (Weeks 5-6)

* Build Sunday Digest UI with domain grouping, optional thematic clustering, single/group restore.
* Add Zen Popup, impact stats, donation triggers, permission onboarding, accessibility basics.
* Polish edge cases and performance testing.

---

This version is now ready for immediate senior dev hand-off. Let me know if you need any section expanded or adjusted further.