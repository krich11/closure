#!/usr/bin/env node
/**
 * generate-promo-images.js — Generates CWS promotional images via Playwright
 *
 * Creates:
 *   - store/promo-tile-440x280.png   (small promo tile)
 *   - store/promo-marquee-1400x560.png (large marquee banner)
 *
 * Usage: node scripts/generate-promo-images.js
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const STORE_DIR = path.join(__dirname, '..', 'store');

const PROMO_HTML = (width, height) => `
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: white;
    overflow: hidden;
    position: relative;
  }
  .bg-circles {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .bg-circles::before {
    content: '';
    position: absolute;
    width: ${width * 0.6}px;
    height: ${width * 0.6}px;
    background: radial-gradient(circle, rgba(45, 138, 78, 0.15) 0%, transparent 70%);
    top: -${height * 0.3}px;
    right: -${width * 0.15}px;
    border-radius: 50%;
  }
  .bg-circles::after {
    content: '';
    position: absolute;
    width: ${width * 0.4}px;
    height: ${width * 0.4}px;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%);
    bottom: -${height * 0.2}px;
    left: -${width * 0.1}px;
    border-radius: 50%;
  }
  .content {
    position: relative;
    z-index: 1;
    text-align: center;
    padding: 0 ${width * 0.08}px;
  }
  .icon {
    width: ${Math.round(height * 0.25)}px;
    height: ${Math.round(height * 0.25)}px;
    margin: 0 auto ${height * 0.06}px;
    background: rgba(255,255,255,0.1);
    border-radius: ${Math.round(height * 0.05)}px;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.15);
  }
  .icon img {
    width: 70%;
    height: 70%;
    object-fit: contain;
  }
  h1 {
    font-size: ${Math.round(height * 0.14)}px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-bottom: ${height * 0.03}px;
    background: linear-gradient(135deg, #ffffff 0%, #94d2bd 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  p {
    font-size: ${Math.round(height * 0.058)}px;
    color: rgba(255,255,255,0.7);
    line-height: 1.4;
    font-weight: 400;
  }
  .badges {
    display: flex;
    gap: ${width * 0.02}px;
    justify-content: center;
    margin-top: ${height * 0.06}px;
  }
  .badge {
    font-size: ${Math.round(height * 0.042)}px;
    padding: ${height * 0.02}px ${width * 0.025}px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: ${height * 0.015}px;
    color: rgba(255,255,255,0.75);
    white-space: nowrap;
  }
</style>
</head>
<body>
  <div class="bg-circles"></div>
  <div class="content">
    <div class="icon">
      <img src="data:image/png;base64,ICON_PLACEHOLDER" alt="Closure icon">
    </div>
    <h1>Closure</h1>
    <p>Tidy tabs. Archive with AI. Reclaim focus.</p>
    <div class="badges">
      <span class="badge">100% Local</span>
      <span class="badge">Zero Data Collection</span>
      <span class="badge">On-Device AI</span>
    </div>
  </div>
</body>
</html>
`;

async function main() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }

  // Read the icon as base64
  const iconPath = path.join(__dirname, '..', 'icons', 'icon-128.png');
  const iconBase64 = fs.readFileSync(iconPath).toString('base64');

  const browser = await chromium.launch({ headless: true });

  const sizes = [
    { name: 'promo-tile-440x280.png', width: 440, height: 280 },
    { name: 'promo-marquee-1400x560.png', width: 1400, height: 560 },
  ];

  for (const { name, width, height } of sizes) {
    const html = PROMO_HTML(width, height).replace('ICON_PLACEHOLDER', iconBase64);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const outPath = path.join(STORE_DIR, name);
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width, height } });
    console.log(`✅ ${name} (${width}x${height})`);
    await page.close();
  }

  await browser.close();
  console.log(`\nPromo images saved to store/`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
