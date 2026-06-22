#!/usr/bin/env node
// check-duplicate-functions.mjs
// Finds duplicate named function definitions between legacy.js and ES modules.
// Exit 1 if forbidden duplicates found.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const ALLOWLIST = new Set([
  '_esc', '_timeout', '_showAuthError', '_clearAuthError',
  'randCode', 'getId', 'getUid',
  'BOT_NAMES', 'BOT_PLAYERS', 'EMOJIS', 'POINTS_TABLE',
]);

function findArrowFunctions(src) {
  // Match: [export] const/let/var NAME = [async] (...)  =>
  // Verify '=>' actually follows the closing paren (not a grouped expression)
  const names = new Set();
  const ARROW_RE = /^[ \t]*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/mg;
  for (const m of src.matchAll(ARROW_RE)) {
    const rest  = src.slice(m.index + m[0].length - 1); // from '('
    let depth = 0, i = 0;
    while (i < rest.length) {
      if (rest[i] === '(')      depth++;
      else if (rest[i] === ')') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
    const after = rest.slice(i).replace(/^[\s\n]+/, '');
    if (after.startsWith('=>')) names.add(m[1]);
  }
  return names;
}

function extractFunctions(src) {
  const names = new Set();

  // Named function declarations (any indentation, with or without export/async)
  const DECL = /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/mg;
  // Named function expressions: const foo = function(  or  const foo = async function(
  const EXPR = /^[ \t]*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function[\s(]/mg;

  for (const m of src.matchAll(DECL)) names.add(m[1]);
  for (const m of src.matchAll(EXPR)) names.add(m[1]);
  for (const n of findArrowFunctions(src)) names.add(n);

  return names;
}

function readJs(fp) { try { return fs.readFileSync(fp, 'utf8'); } catch { return ''; } }

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'scripts') walkJs(full, out);
    else if (e.isFile() && e.name.endsWith('.js') && e.name !== 'legacy.js') out.push(full);
  }
  return out;
}

const legacySrc   = readJs(path.join(ROOT, 'js/legacy.js'));
const legacyFns   = extractFunctions(legacySrc);
const moduleFiles = walkJs(path.join(ROOT, 'js'));

let totalForbidden = 0;
const report = [];

for (const file of moduleFiles.sort()) {
  const fns  = extractFunctions(readJs(file));
  const rel  = path.relative(ROOT, file);
  const dupes = [...fns].filter(fn => legacyFns.has(fn) && !ALLOWLIST.has(fn));
  if (dupes.length > 0) { report.push({ file: rel, dupes }); totalForbidden += dupes.length; }
}

console.log('\n── Duplicate Function Check ─────────────────────────────────────');
console.log(`ROOT    = ${ROOT}`);
console.log(`legacy  = ${path.join(ROOT, 'js/legacy.js')}`);
console.log(`modules = ${moduleFiles.length} files`);
console.log('─────────────────────────────────────────────────────────────────');
if (report.length === 0) {
  console.log('✅ No forbidden duplicates between legacy.js and ES modules.\n');
} else {
  for (const { file, dupes } of report) {
    console.log(`\n❌ legacy.js ↔ ${file}: ${dupes.length} forbidden duplicate(s)`);
    for (const fn of dupes) console.log(`   - ${fn}`);
  }
  console.log(`\nTotal forbidden duplicates: ${totalForbidden}`);
}
console.log('──────────────────────────────────────────────────────────────────\n');
process.exit(totalForbidden > 0 ? 1 : 0);
