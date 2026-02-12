#!/usr/bin/env node
/**
 * build-zip.js — Creates a Chrome Web Store submission .zip
 *
 * Includes only the files needed for the extension runtime.
 * Excludes tests, dev configs, node_modules, source CSS, and docs.
 *
 * Usage: node scripts/build-zip.js
 *        npm run build:zip
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const outFile = path.join(ROOT, `closure-v${version}.zip`);

// Files and directories to include in the submission zip
const INCLUDE = [
  'manifest.json',
  'background.js',
  'content.js',
  'privacy-policy.html',
  'popup/',
  'digest/',
  'settings/',
  'onboarding/',
  'offscreen/',
  'icons/',
];

// Verify all included paths exist
const missing = INCLUDE.filter(p => !fs.existsSync(path.join(ROOT, p)));
if (missing.length > 0) {
  console.error(`❌ Missing files/dirs: ${missing.join(', ')}`);
  process.exit(1);
}

// Remove old zip if it exists
if (fs.existsSync(outFile)) {
  fs.unlinkSync(outFile);
}

// Build the zip using the system zip command
const includeArgs = INCLUDE.map(p => {
  // Directories need -r flag handling; zip recurses them automatically
  return p;
}).join(' ');

try {
  execSync(`cd "${ROOT}" && zip -r "${outFile}" ${includeArgs} -x "*.DS_Store"`, {
    stdio: 'inherit',
  });
} catch (err) {
  console.error('❌ zip command failed:', err.message);
  process.exit(1);
}

// Report result
const stats = fs.statSync(outFile);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`\n✅ Created ${path.basename(outFile)} (${sizeKB} KB)`);
console.log(`   Version: ${version}`);
console.log(`   Files included: ${INCLUDE.join(', ')}`);
