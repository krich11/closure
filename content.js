/**
 * Closure — Content Script (content.js)
 * @version 1.5.0
 *
 * Injected on-demand via chrome.scripting.executeScript ONLY when
 * the user opts in to "Rich Page Analysis" in Settings. This grants
 * Closure the scripting + host_permissions needed to read page content.
 *
 * Extraction is intentionally lean: we grab structured metadata and
 * a text excerpt, then return immediately. No DOM mutation, no
 * persistent listeners, no side effects.
 */

(() => {
  /**
   * Extract structured page metadata for AI consumption.
   * Called via chrome.scripting.executeScript — return value is
   * captured by the service worker.
   */
  function extractPageContent() {
    const result = {
      title: document.title || '',
      metaDescription: '',
      ogTitle: '',
      ogDescription: '',
      ogType: '',
      canonical: '',
      headings: [],
      excerpt: '',
      httpStatus: null,
    };

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) result.metaDescription = metaDesc.content?.trim() || '';

    // Open Graph tags — rich topic signal
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) result.ogTitle = ogTitle.content?.trim() || '';

    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) result.ogDescription = ogDesc.content?.trim() || '';

    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType) result.ogType = ogType.content?.trim() || '';

    // Canonical URL (resolves redirects, vanity URLs)
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) result.canonical = canonical.href || '';

    // First few headings — structural outline of the page
    const headingEls = document.querySelectorAll('h1, h2, h3');
    for (let i = 0; i < Math.min(headingEls.length, 6); i++) {
      const text = headingEls[i].textContent?.trim();
      if (text) result.headings.push(text);
    }

    // First 800 chars of visible body text — enough context for AI
    const bodyText = document.body?.innerText || '';
    result.excerpt = bodyText.substring(0, 800).trim();

    // HTTP status via Navigation Timing API (when available)
    try {
      const navEntry = performance.getEntriesByType('navigation')[0];
      if (navEntry && navEntry.responseStatus) {
        result.httpStatus = navEntry.responseStatus;
      }
    } catch {
      // Performance API not available in some contexts
    }

    return result;
  }

  return extractPageContent();
})();
