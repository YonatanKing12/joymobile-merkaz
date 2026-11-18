// Parser coverage over every supplier title: how many land in each step, how many have every fact the builder
// checks, and the titles it could not read.
// Usage: node .github/pc-builder/coverage.mjs [products.json | <csv>...]   (default: fixtures/products.json)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTitle, STEP_KEYS } from '../../assets/pc-builder-parser.js';
import { readCsvRows } from './build-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let titles;
if (args.length && args.every((a) => a.endsWith('.csv'))) titles = readCsvRows(args).map((r) => r.title);
else titles = JSON.parse(readFileSync(args[0] || join(here, 'fixtures/products.json'), 'utf8')).products.map((p) => p.title);

const stats = {};
const unknown = [];
const partial = [];
for (const title of titles) {
  const { category, facts, missing } = parseTitle(title);
  const key = category || 'unrecognized';
  stats[key] ||= { total: 0, complete: 0 };
  stats[key].total++;
  if (!category) unknown.push(title);
  else if (missing.length) partial.push(`[${category}] missing ${missing.join(', ')}: ${title}`);
  else stats[key].complete++;
  if (process.env.VERBOSE) console.log(category, JSON.stringify(facts), '|', title);
}

const order = [...STEP_KEYS, 'system', 'ignore', 'unrecognized'];
console.log(`Titles: ${titles.length}\n`);
console.log('step'.padEnd(14), 'titles'.padStart(6), 'all facts'.padStart(10), 'coverage'.padStart(9));
let partsTotal = 0;
let partsComplete = 0;
for (const k of order) {
  const s = stats[k];
  if (!s) continue;
  const pct = k === 'system' || k === 'ignore' || k === 'unrecognized' ? '' : `${((100 * s.complete) / s.total).toFixed(1)}%`;
  if (STEP_KEYS.includes(k)) { partsTotal += s.total; partsComplete += s.complete; }
  console.log(k.padEnd(14), String(s.total).padStart(6), String(STEP_KEYS.includes(k) ? s.complete : '').padStart(10), pct.padStart(9));
}
console.log(`\nBuilder parts: ${partsTotal}, with every fact: ${partsComplete} (${((100 * partsComplete) / partsTotal).toFixed(1)}%)`);
console.log(`Recognized (any category incl. system/ignore): ${titles.length - unknown.length}/${titles.length}`);
if (unknown.length) console.log(`\nUnrecognized (${unknown.length}):\n  ${unknown.join('\n  ')}`);
if (partial.length) console.log(`\nMissing facts (${partial.length}):\n  ${partial.join('\n  ')}`);
