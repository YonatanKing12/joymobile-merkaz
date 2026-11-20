// Builds the address check's lists (snippets/address-check, assets/address-check.js) from data.gov.il:
// - assets/il-localities.json: every locality as Israel Post spells it, with its English name and the file of its streets;
// - assets/il-streets-NN.json: the streets of the localities, in a few files of about the same size, so the cart loads
//   only the one of the chosen city.
// Sources: "רחובות בישראל" (resource 9ad3862c-8391-4b2f-84a4-2d4c68625f4b; the same rows as a7296d1a-f8c9-4b70-96c2-6ebb4352f8e3,
// there with padded names), the population registry's names that Israel Post's address file uses, as the dashboard's
// src/server/shipper/localities-data.ts and streets-data.ts; and "רשימת יישובים" (5c78e9fa-c2e2-4771-93ff-7f400a12f7ba),
// for the English names (the checkout gets "Haifa", "Beersheba").
// Usage: node .github/address-check/generate.mjs   (network; rewrites the files; run again when the lists change)
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '../..');
const API = 'https://data.gov.il/api/3/action/datastore_search';
const STREETS = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';
const LOCALITIES = '5c78e9fa-c2e2-4771-93ff-7f400a12f7ba';
const SHARDS = 12;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function all(resource) {
  const rows = [];
  for (let offset = 0; ; offset += 32000) {
    const res = await fetch(`${API}?resource_id=${resource}&limit=32000&offset=${offset}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${resource}: HTTP ${res.status}`);
    const { result } = await res.json();
    rows.push(...result.records);
    if (rows.length >= result.total || !result.records.length) return rows;
  }
}

const streetRows = await all(STREETS);
const localityRows = await all(LOCALITIES);

const english = new Map();
for (const r of localityRows) {
  const en = clean(r['שם_ישוב_לועזי']);
  if (en) english.set(String(+r['סמל_ישוב']), en.toLowerCase());
}

const byCity = new Map(); // name → { code, streets:Set }
for (const r of streetRows) {
  const city = clean(r['שם_ישוב']);
  const street = clean(r['שם_רחוב']);
  if (!city) continue;
  if (!byCity.has(city)) byCity.set(city, { code: String(+r['סמל_ישוב']), streets: new Set() });
  if (street) byCity.get(city).streets.add(street);
}

const collator = new Intl.Collator('he');
const names = [...byCity.keys()].sort(collator.compare);
// A locality whose only name is its own (a kibbutz, a moshav, a tribe) has no streets to check (as the dashboard).
const packed = new Map();
for (const city of names) {
  const s = [...byCity.get(city).streets].sort(collator.compare);
  if (s.length && !(s.length === 1 && s[0] === city)) packed.set(city, s.join('|'));
}

// Largest first into the lightest file: files of about the same size.
const shards = Array.from({ length: SHARDS }, () => ({ bytes: 0, data: {} }));
const shardOf = new Map();
for (const city of [...packed.keys()].sort((a, b) => packed.get(b).length - packed.get(a).length)) {
  let i = 0;
  for (let j = 1; j < SHARDS; j++) if (shards[j].bytes < shards[i].bytes) i = j;
  shards[i].data[city] = packed.get(city);
  shards[i].bytes += Buffer.byteLength(packed.get(city));
  shardOf.set(city, i);
}

const localities = names.map((city) => {
  const en = english.get(byCity.get(city).code) || '';
  return shardOf.has(city) ? [city, en, shardOf.get(city)] : [city, en];
});
const stamp = new Date().toISOString().slice(0, 10);
const write = (file, value) => fs.writeFileSync(path.join(repo, 'assets', file), JSON.stringify(value) + '\n');
write('il-localities.json', { source: `data.gov.il ${STREETS}, ${LOCALITIES}`, read: stamp, localities });
shards.forEach((s, i) => {
  const ordered = Object.fromEntries(Object.keys(s.data).sort(collator.compare).map((k) => [k, s.data[k]]));
  write(`il-streets-${String(i).padStart(2, '0')}.json`, ordered);
});
const streetCount = [...packed.values()].reduce((n, v) => n + v.split('|').length, 0);
console.log(`${names.length} localities (${english.size} English names), ${packed.size} with streets, ${streetCount} streets, ${SHARDS} files of ${shards.map((s) => Math.round(s.bytes / 1024)).join('/')} KB`);
