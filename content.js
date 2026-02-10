#!/usr/bin/env node
/**
 * Closure — Content Script (content.js)
 * @version 1.2.2
 *
 * Injected on-demand via chrome.scripting.executeScript.
 * Handles multiple actions based on the injection context:
 *
 *   - detectError:  check HTTP status + page error patterns
 *   - extractContent:  pull title, meta, text, favicon for archival
 *   - showStayOfExecution:  inject pre-archival overlay (Phase 2)
 *
 * This script is designed to be injected with { func } style,
 * receiving an action parameter. Each function returns a result
 * object to the caller.
 */

// ─── Error Detection ────────────────────────────────────────────

/**
 * Detect whether the current page is in an error state.
 *
 * Detection criteria (checked in order):
 * 1. HTTP response status via Performance Navigation Timing API
 * 2. Page title or body text matching known error patterns
 *
 * @returns {{ isError: boolean, reason: string }}
 */
function detectPageError() {
  const result = { isError: false, reason: '' };

  // 1. Check HTTP status via Navigation Timing API
  try {
    const navEntries = performance.getEntriesByType('navigation');
    if (navEntries.length > 0) {
      const status = navEntries[0].responseStatus;
      if (status && status >= 400) {
        result.isError = true;
        result.reason = `HTTP ${status}`;
        return result;
      }
    }
  } catch {
    // Navigation Timing API may not be available — continue to pattern matching
  }

  // 2. Check title and body text for error patterns
  const ERROR_PATTERNS = [
    /\b404\b/i,
    /\b500\b/i,
    /\b502\b/i,
    /\b503\b/i,
    /timed?\s*out/i,
    /site\s+can'?t\s+be\s+reached/i,
    /ERR_/i,
    /DNS_PROBE/i,
    /server\s+error/i,
    /page\s+not\s+found/i,
    /this\s+site\s+can'?t\s+be\s+reached/i,
    /ERR_CONNECTION_REFUSED/i,
    /ERR_NAME_NOT_RESOLVED/i,
    /ERR_INTERNET_DISCONNECTED/i,
    /ERR_CONNECTION_TIMED_OUT/i,
    /ERR_SSL_PROTOCOL_ERROR/i,
    /ERR_CERT_/i,
    /NET::ERR_/i,
  ];

  const title = document.title || '';
  // Only grab the first 2000 chars of body text to keep it fast
  const bodyText = (document.body?.innerText || '').substring(0, 2000);
  const combined = `${title} ${bodyText}`;

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(combined)) {
      const match = combined.match(pattern);
      result.isError = true;
      result.reason = `Title/body match: ${match ? match[0] : pattern.source}`;
      return result;
    }
  }

  return result;
}

// ─── Content Extraction (Phase 2) ───────────────────────────────

/**
 * Extract page content for archival summarization.
 *
 * @returns {{ title: string, metaDescription: string, text: string, faviconUrl: string }}
 */
function extractPageContent() {
  const title = document.title || '';

  // Meta description
  const metaEl = document.querySelector('meta[name="description"]');
  const metaDescription = metaEl ? metaEl.getAttribute('content') || '' : '';

  // First 500 chars of visible body text
  const text = (document.body?.innerText || '').substring(0, 500);

  // Favicon URL — try <link rel="icon"> first, fall back to /favicon.ico
  const iconLink = document.querySelector('link[rel~="icon"]');
  const faviconUrl = iconLink
    ? iconLink.href
    : `${location.origin}/favicon.ico`;

  return { title, metaDescription, text, faviconUrl };
}

// ─── Execution Entry Point ──────────────────────────────────────
// This script is injected via chrome.scripting.executeScript with
// { func: ..., args: [action] }. The wrapping function in
// background.js calls the appropriate function and returns the result.
//
// When injected directly (no function wrapper), this module exposes
// detectPageError and extractPageContent on the global scope so
// background.js can reference them by name.
