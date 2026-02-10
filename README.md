# Closure

**Tab-Shame Absolution Engine** — a privacy-first Chromium extension that tidies tabs, archives idle ones with local AI summaries, and reclaims your focus.

Nothing leaves your device. Ever.

## Features

- **Clean Slate Automator** — when you open 3+ tabs from the same domain (e.g. github.com), they're automatically grouped and collapsed into a single color-coded label. Click the label to expand and see the tabs inside. Nothing is closed, just organized.

- **AI Topic Grouping** — periodically scans your ungrouped tabs and groups them by content using on-device AI. A Stack Overflow answer, a blog post, and a GitHub issue about "React hooks" would be grouped together, even though they're from different sites. Runs on a configurable schedule (10 min to 24 hours), with an "overnight only" option. Also available as a one-click "Cluster by Topic" button in the popup.

- **Dead End Sweeper** — every 60 minutes, scans for tabs that are broken or stuck: HTTP errors (404, 500, 502, 503), DNS failures, timeouts, and pages that never finished loading. Logs them for reference, closes them, and briefly shows a badge count of how many were swept.

- **Graceful Exit** — tabs you haven't touched for a configurable period (default 24 hours) are archived: the page content is summarized into 3 bullet points by Chrome's on-device Gemini Nano AI, then the tab is closed. Before archival, a "Stay of Execution" overlay gives you 10 minutes to keep the tab open or snooze it. If AI isn't available, the page title, URL, and first 500 characters are saved instead.

- **Sunday Digest** — a full-page dashboard of everything that's been archived. Entries are grouped by domain by default. With AI enabled, you can re-cluster entries by *topic* instead of domain — for example, grouping a Stack Overflow answer, a blog post, and a GitHub issue all under "React performance" because they share a theme, even though they came from different sites.

- **Zen Popup** — a quick-glance status ring (green/yellow/red based on open tab count), a "nuclear" button that archives all tabs idle for 4+ hours at once, and running stats on tabs tidied and estimated RAM saved.

- **Safety Net** — pinned tabs and tabs playing audio are never touched by any feature. You can also whitelist specific domains (e.g. `mail.google.com`) to make them fully immune to grouping, sweeping, and archival.

## Requirements

- Chromium-based browser (Chrome 138+)
- For AI summaries: enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and `chrome://flags/#optimization-guide-on-device-model` (set to "Enabled BypassPerfRequirement")

## Install from Source

```bash
git clone https://github.com/krich11/closure.git
cd closure
npm install
npm run build:css
```

Then load as an unpacked extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `closure` folder

## Development

```bash
npm run build:css       # Rebuild Tailwind CSS
npm run version:sync    # Propagate VERSION file to all project files
npm test                # Run Playwright test suite (109 tests)
npm run test:headed     # Run tests with browser visible
npm run test:report     # View last test report
```

## Privacy

Zero data exfiltration. No analytics, no telemetry, no remote calls of any kind. AI runs entirely on-device via Chrome's built-in Gemini Nano. All data stored in `chrome.storage.local`.

## Support

This extension is free and always will be. If it helps you, consider [buying the dev an energy drink](https://ko-fi.com/krich11).

> *"This runs 100% locally. Support the code that keeps your privacy safe."*

## TODO

- [ ] Vertical tabs tip in settings — link users to `chrome://flags/#vertical-tabs` (Chrome 145+, no extension API available)
- [ ] Chrome Web Store listing
- [ ] Icon design (16, 48, 128 px)

## License

ISC
