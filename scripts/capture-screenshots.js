#!/usr/bin/env node
/**
 * capture-screenshots.js — Captures Chrome Web Store listing screenshots
 *
 * Uses Playwright to open each extension page and capture at 1280x800.
 * Saves to store/screenshots/.
 *
 * Usage: node scripts/capture-screenshots.js <extension-id>
 *
 * The extension ID can be found at chrome://extensions after loading unpacked.
 * Example: node scripts/capture-screenshots.js abcdefghijklmnopqrstuvwxyz
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(EXTENSION_PATH, 'store', 'screenshots');

async function main() {
  // Ensure output dir exists
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // Launch Chrome with the extension loaded
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
    ],
    viewport: { width: 1280, height: 800 },
  });

  // Wait for extension to initialize
  let extensionId;
  let retries = 10;
  while (retries-- > 0) {
    const targets = context.serviceWorkers();
    const sw = targets.find(t => t.url().includes('chrome-extension://'));
    if (sw) {
      extensionId = new URL(sw.url()).hostname;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!extensionId) {
    console.error('❌ Could not detect extension ID. Is the extension loading properly?');
    await context.close();
    process.exit(1);
  }

  console.log(`Extension ID: ${extensionId}`);

  const pages = [
    { name: '01-popup',     url: `chrome-extension://${extensionId}/popup/popup.html`,         desc: 'Zen Popup' },
    { name: '02-digest',    url: `chrome-extension://${extensionId}/digest/digest.html`,       desc: 'Sunday Digest' },
    { name: '03-settings',  url: `chrome-extension://${extensionId}/settings/settings.html`,   desc: 'Settings' },
    { name: '04-onboarding',url: `chrome-extension://${extensionId}/onboarding/onboarding.html`,desc: 'Onboarding' },
  ];

  for (const { name, url, desc } of pages) {
    console.log(`📸 Capturing ${desc}...`);
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    // Small delay for CSS transitions
    await page.waitForTimeout(500);
    const outPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`   Saved: ${outPath}`);
    await page.close();
  }

  await context.close();
  console.log(`\n✅ Screenshots saved to store/screenshots/`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
