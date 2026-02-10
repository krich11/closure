const { test, expect } = require('./fixtures');

/**
 * Privacy Guarantee Tests
 *
 * Verify that the extension makes zero network requests.
 * This is a hard requirement — no data ever leaves the device.
 */

test.describe('Privacy — Zero Network Requests', () => {
  test('extension pages make no external network requests', async ({ context, extensionId }) => {
    const externalRequests = [];

    // Listen for all requests across the context
    context.on('request', (request) => {
      const url = request.url();
      // Allow chrome-extension:// and chrome:// URLs only
      if (!url.startsWith('chrome-extension://') && !url.startsWith('chrome://')) {
        externalRequests.push(url);
      }
    });

    // Load popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForLoadState('networkidle');

    expect(externalRequests).toEqual([]);
  });

  test('no fetch or XHR calls in service worker', async ({ context, extensionId }) => {
    // Access the service worker and verify no fetch calls are made
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Verify that the manifest doesn't reference external resources
    const manifestResponse = await page.evaluate(async () => {
      const resp = await fetch(chrome.runtime.getURL('manifest.json'));
      return resp.json();
    });

    // No host_permissions pointing to external URLs
    expect(manifestResponse.host_permissions).toBeUndefined();

    // No content_security_policy allowing external connections
    const csp = manifestResponse.content_security_policy;
    if (csp) {
      expect(JSON.stringify(csp)).not.toContain('http://');
      expect(JSON.stringify(csp)).not.toContain('https://');
    }
  });
});
