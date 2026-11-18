// Builds fixtures/products.json (the shape of /collections/<handle>/products.json) from the supplier CSVs
// (columns: code, model, title, cost, days, warranty, national price incl. VAT, [supplier,] image URL).
// Usage: node .github/pc-builder/build-fixture.mjs <csv>... > .github/pc-builder/fixtures/products.json
import { readFileSync } from 'node:fs';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function readCsvRows(files) {
  const out = [];
  for (const file of files) {
    const [head, ...rows] = parseCsv(readFileSync(file, 'utf8'));
    const col = (name) => head.findIndex((h) => h.includes(name));
    const iTitle = col('כותרת');
    const iPrice = col('מחיר');
    const iImg = col('תמונה');
    for (const r of rows) out.push({ code: r[0], model: r[1], title: r[iTitle], price: r[iPrice], image: r[iImg] });
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const rows = readCsvRows(process.argv.slice(2));
  const seen = new Set();
  const products = [];
  rows.forEach((r, i) => {
    if (!r.title || seen.has(r.code)) return;
    seen.add(r.code);
    const id = 9000000000 + i;
    products.push({
      id,
      title: r.title.trim(),
      handle: r.code.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      vendor: 'Joy Mobile Merkaz',
      product_type: '',
      tags: ['דרופשיפינג'],
      variants: [{ id: id * 10 + 1, title: 'Default Title', price: Number(r.price).toFixed(2), available: true, sku: r.code }],
      // One host for every picture (the supplier's own pictures, mirrored by code); the preview serves them locally.
      images: [{ src: `https://raw.githubusercontent.com/YonatanKing12/joymobile-merkaz/media-morlevi/morlevi/${encodeURIComponent(r.code)}.jpg` }],
    });
  });
  process.stdout.write(JSON.stringify({ products }, null, 0) + '\n');
}
