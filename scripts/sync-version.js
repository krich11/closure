#!/usr/bin/env node
/**
 * scripts/sync-version.js
 *
 * Reads the version from the root VERSION file and applies it to every
 * file that carries a version string.  Run via `npm run version:sync`.
 *
 * Targets:
 *   - manifest.json          →  "version": "X.Y.Z"
 *   - package.json           →  "version": "X.Y.Z"
 *   - package-lock.json      →  top-level "version" fields only
 *   - background.js          →  @version docblock
 *   - content.js             →  @version docblock
 *   - popup/popup.js         →  @version docblock
 *   - settings/settings.js   →  @version docblock
 *   - digest/digest.js       →  @version docblock
 *   - onboarding/onboarding.js → @version docblock
 *   - settings/settings.html →  footer version text
 *   - functional-specification.md → **Version:** line
 *   - PLAN.md                →  heading version
 *   - tests/*.spec.js        →  @version docblocks
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf-8').trim();

if (!/^\d+\.\d+\.\d+$/.test(VERSION)) {
  console.error(`Invalid version in VERSION file: "${VERSION}"`);
  process.exit(1);
}

console.log(`Syncing version → ${VERSION}\n`);

/* ── helpers ──────────────────────────────────────────────────── */

/** Replace all matches of `pattern` in `filePath` with `replacement`. */
function patchFile(filePath, pattern, replacement, label) {
  const abs = path.resolve(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    console.log(`  SKIP  ${filePath} (not found)`);
    return;
  }
  const before = fs.readFileSync(abs, 'utf-8');
  const after = before.replace(pattern, replacement);
  if (before === after) {
    console.log(`  OK    ${filePath} (already ${VERSION})`);
  } else {
    fs.writeFileSync(abs, after, 'utf-8');
    console.log(`  DONE  ${filePath}`);
  }
}

/* ── JSON files ───────────────────────────────────────────────── */

function patchJson(filePath) {
  const abs = path.resolve(ROOT, filePath);
  if (!fs.existsSync(abs)) {
    console.log(`  SKIP  ${filePath} (not found)`);
    return;
  }
  const json = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  let changed = false;

  if (json.version && json.version !== VERSION) {
    json.version = VERSION;
    changed = true;
  }

  // manifest.json has a version_name field for CWS display
  if (json.version_name !== undefined && json.version_name !== VERSION) {
    json.version_name = VERSION;
    changed = true;
  }

  // package-lock.json has a nested packages[""] entry
  if (json.packages && json.packages[''] && json.packages[''].version !== VERSION) {
    json.packages[''].version = VERSION;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(abs, JSON.stringify(json, null, 2) + '\n', 'utf-8');
    console.log(`  DONE  ${filePath}`);
  } else {
    console.log(`  OK    ${filePath} (already ${VERSION})`);
  }
}

/* ── JS docblock @version ─────────────────────────────────────── */

function patchDocblock(filePath) {
  patchFile(
    filePath,
    /@version \d+\.\d+\.\d+/g,
    `@version ${VERSION}`,
    filePath
  );
}

/* ── apply ────────────────────────────────────────────────────── */

// JSON
patchJson('manifest.json');
patchJson('package.json');
patchJson('package-lock.json');

// JS docblocks
const jsFiles = [
  'background.js',
  'content.js',
  'popup/popup.js',
  'settings/settings.js',
  'digest/digest.js',
  'onboarding/onboarding.js',
];
jsFiles.forEach(patchDocblock);

// Test files
const testDir = path.join(ROOT, 'tests');
if (fs.existsSync(testDir)) {
  fs.readdirSync(testDir)
    .filter((f) => f.endsWith('.spec.js'))
    .forEach((f) => patchDocblock(`tests/${f}`));
}

// settings.html footer
patchFile(
  'settings/settings.html',
  /Closure v\d+\.\d+\.\d+/g,
  `Closure v${VERSION}`,
  'settings/settings.html'
);

// functional-specification.md
patchFile(
  'functional-specification.md',
  /\*\*Version:\*\* \d+\.\d+\.\d+/g,
  `**Version:** ${VERSION}`,
  'functional-specification.md'
);

// PLAN.md heading
patchFile(
  'PLAN.md',
  /# Closure Plan — v\d+\.\d+\.\d+/g,
  `# Closure Plan — v${VERSION}`,
  'PLAN.md'
);

console.log(`\n✓ All files synced to v${VERSION}`);
