// Parser coverage over every supplier title: how many land in each step, how many have every fact the builder
// checks, and the titles it could not read.
// Usage: node .github/pc-builder/coverage.mjs [products.json | <csv>...]   (default: fixtures/products.json)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTitle, STEP_KEYS, toPart } from '../../assets/pc-builder-parser.js';
import { readCsvRows } from './build-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let titles;
let products = null;
if (args.length && args.every((a) => a.endsWith('.csv'))) titles = readCsvRows(args).map((r) => r.title);
else {
  products = JSON.parse(readFileSync(args[0] || join(here, 'fixtures/products.json'), 'utf8')).products;
  titles = products.map((p) => p.title);
}

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

// The facts Lior's rules use, per kind: how many parts have each (from the title, the description or the verified
// SPECS table, by SKU). Needs a products.json (SKUs and descriptions), not a CSV.
if (products) {
  const has = (v) => v !== null && v !== undefined && v !== '';
  const SPEC_FACTS = {
    cpu: { socket: (f) => has(f.socket), 'generation (BIOS)': (f) => has(f.series), 'peak watts': (f) => has(f.watts) },
    board: { socket: (f) => has(f.socket), chipset: (f) => has(f.chipset), 'DDR generation': (f) => has(f.memory), 'form factor': (f) => has(f.formFactor), 'M.2 PCIe gen': (f) => has(f.m2gen), 'USB-C header': (f) => has(f.usbcHeader), 'fan/ARGB headers': (f) => has(f.fanHeaders) },
    ram: { 'DDR generation': (f) => has(f.memory), speed: (f) => has(f.speed), sticks: (f) => has(f.modules), 'XMP/EXPO': (f) => has(f.profile), height: (f) => has(f.height) },
    gpu: { chip: (f) => has(f.chip), 'board power': (f) => has(f.watts), length: (f) => has(f.length), 'thickness (slots)': (f) => has(f.thickness), 'power connector': (f) => has(f.pin16), "maker's PSU": (f) => has(f.recPsu) },
    case: { 'board form factor': (f) => has(f.formFactor), 'max GPU length': (f) => has(f.gpuMax), 'max cooler height': (f) => has(f.coolerMax), radiators: (f) => has(f.rad), 'front USB-C (known)': (f) => f.usbc !== null && f.usbc !== undefined, 'included fans': (f) => has(f.fans), 'PSU size': (f) => has(f.psu) },
    psu: { watts: (f) => has(f.watts), 'ATX 3 (known)': (f) => f.atx3 === true || f.atx3 === false, 'size (ATX/SFX)': (f) => has(f.formFactor) },
    cooler: { type: (f) => has(f.type), 'TDP rating': (f) => has(f.tdp), 'height (air)': (f) => f.type !== 'air' || has(f.height), 'sockets': (f) => has(f.sockets), 'radiator (AIO)': (f) => f.type !== 'liquid' || has(f.radiator), 'RAM clearance (dual tower)': (f) => !f.dual || has(f.ramClearance) },
    storage: { kind: (f) => has(f.kind), 'PCIe gen (NVMe)': (f) => f.kind !== 'NVMe' || has(f.gen), 'M.2 length (NVMe)': (f) => f.kind !== 'NVMe' || has(f.m2) },
  };
  const parts = products.map((p) => toPart(p)).filter(Boolean);
  console.log('\nSpec coverage for the compatibility rules (parts in the collection with the fact):');
  for (const [cat, checks] of Object.entries(SPEC_FACTS)) {
    const list = parts.filter((p) => p.category === cat);
    if (!list.length) continue;
    const cells = Object.entries(checks).map(([name, fn]) => {
      const n = list.filter((p) => fn(p.facts)).length;
      return `${name} ${n}/${list.length} (${Math.round((100 * n) / list.length)}%)`;
    });
    console.log(`  ${cat.padEnd(8)} ${String(list.length).padStart(3)}: ${cells.join(' · ')}`);
  }
  if (process.env.MISSING) {
    for (const cat of ['gpu', 'case', 'cooler', 'psu']) {
      const list = parts.filter((p) => p.category === cat && !p.verified);
      console.log(`\nNot in SPECS (${cat}, ${list.length}):\n  ${list.map((p) => `${p.sku} | ${p.title}`).join('\n  ')}`);
    }
  }
}
