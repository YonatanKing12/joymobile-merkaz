// Quantities (several of a part) and the step search: assets/pc-builder-parser.js (qtyLimit, clampQty, setQty,
// addDrive, removeDrive, checkQuantities, powerOf, lines; normalizeSearch, queryWords, matchesQuery).
// Real supplier titles; slot counts set by hand where no live board states them (marked "pc.*", as the metafields would).
// node --test .github/pc-builder/quantity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDrive, applyChoice, boardLimits, canAddDrive, checkBuild, clampQty, isOrderable, lines, matchesQuery, normalizeSearch,
  parseTitle, powerOf, qtyLimit, qtyOf, queryWords, removeDrive, sanitize, setQty, STEP_KEYS, toPart, UNVERIFIED, usageOf,
} from '../../assets/pc-builder-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(readFileSync(join(here, 'fixtures/live-products.json'), 'utf8')).products;
const liveParts = live.map((p) => toPart(p)).filter((p) => p && STEP_KEYS.includes(p.category));

let nextId = 1;
const part = (title, price = 100, overrides = {}) =>
  toPart({ id: 800000 + nextId, title, vendor: '', variants: [{ id: 8000000 + nextId++, price: String(price), available: true, sku: null }], images: [] }, overrides);

const cpu = part('מעבד AMD Ryzen 7 9800X3D AM5 Tray', 1900);
const board = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5 1GB LAN', 589);
const itx = part('לוח אם Gigabyte B850I AORUS PRO Mini-ITX DDR5 AM5 WIFI7', 1100);
const ram = part('זכרון קיט לנייח CORSAIR Vengeance 2X16 32GB DDR5 6000 CL30', 500);
const stick = part('זכרון לנייח KLEVV Standard 16GB DDR5 5600MHZ C46', 220);
const gpu = part('כרטיס מסך GIGABYTE GeForce RTX 5070 WINDFORCE OC SFF 12G', 2700);
const nvme = part('דיסק פנימי Kingston NV3 1TB NVME GEN 4.0 M.2 2280 6000/4000Mb/s', 300);
const nvme2 = part('דיסק פנימי Samsung 990 PRO 2TB GEN4 up to 7450 read 6900 Write', 700);
const nvme3 = part('דיסק פנימי Crucial P310 2TB NVMe Gen4 M.2 2280 Heatsink PS5', 600);
const hdd = part('דיסק פנימי Seagate BarraCuda 4B 3.5 5400RPM 256MB Cache', 400);
const cooler = part('קירור נוזלי Cooler Master MasterLiquid 360 Core ARGB 280W', 450);
const psu850 = part('ספק כוח Gigabyte UD850GM PG5 850W 80 Plus Gold ATX 3.0', 600);
const psu650 = part('ספק כוח Corsair CX650 650W 80 Plus Bronze', 250);
const kase = part('מארז Antec C5 ARGB Mid Tower ATX', 400);
const fans = part('מאווררים למארז ANTEC NEON 120 ARGB BLACK 3PK', 93);

const base = () => ({ cpu, board, ram, gpu, storage: nvme, cooler, psu: psu850, case: kase, extra: [], drives: [], qty: {} });

/* ---------- data ---------- */

test('board slot facts: from the title, the pc.* metafields, Mini-ITX, else the safe defaults', () => {
  assert.equal(parseTitle('לוח לאינטל דור 15 Gigabyte Z890 EAGLE 2.5GbE 4XM.2 Slots ATX LGA1').facts.m2Slots, 4);
  assert.equal(parseTitle('לוח אם Gigabyte B650M D3HP 1.3 DDR5 AM5 Micro-Atx').facts.m2Slots, null);
  const meta = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5', 589, { ram_slots: '2', m2_slots: 3, sata_ports: 4, pcie_x16: 1, cpu_sockets: 2, max_memory: '128' });
  assert.deepEqual(
    Object.fromEntries(['ramSlots', 'm2Slots', 'sataPorts', 'pcieX16', 'cpuSockets', 'maxMemory'].map((k) => [k, meta.facts[k]])),
    { ramSlots: 2, m2Slots: 3, sataPorts: 4, pcieX16: 1, cpuSockets: 2, maxMemory: 128 },
  );
  const L = boardLimits(board);
  assert.deepEqual([L.ramSlots, L.m2Slots, L.sataPorts, L.pcieX16, L.cpuSockets], [
    { max: 4, known: false }, { max: 2, known: false }, { max: 4, known: false }, { max: 2, known: false }, { max: 1, known: false },
  ]);
  assert.equal(L.maxMemory.max, 192);
  const I = boardLimits(itx);
  assert.deepEqual([I.ramSlots, I.pcieX16], [{ max: 2, known: true }, { max: 1, known: true }]);
  assert.deepEqual(boardLimits(null).ramSlots, { max: 4, known: false }, 'no board yet: the default');
  assert.equal(part('מאווררים למארז Antec Orbit 120 ARGB 3 Pack', 93).facts.fans, 3);
  assert.equal(part('מאוורר למארז Antec Neon 120mm ARGB PWM', 34).facts.fans, 1);
  // A PSU's and a card's power connectors (pc.pcie_8pin, pc.pcie_16pin).
  assert.deepEqual([part('ספק כוח Corsair CX650 650W', 250, { pcie_8pin: 2, pcie_16pin: 0 }).facts.eightPin, part('ספק כוח Corsair CX650 650W', 250, { pcie_16pin: 0 }).facts.pin16Count], [2, 0]);
});

/* ---------- RAM ---------- */

test('RAM: kits up to the board slots (default 4 modules), Mini-ITX 2, and the board capacity', () => {
  const s = base();
  assert.equal(qtyLimit(s, ram).max, 2, '2-stick kit on a 4-slot default board: 2 kits');
  assert.equal(qtyLimit(s, ram).assumed, true);
  assert.equal(qtyLimit({ ...s, ram: stick }, stick).max, 4, 'single sticks: 4');
  assert.equal(qtyLimit({ ...s, board: itx }, ram).max, 1, 'Mini-ITX: one 2-stick kit');
  assert.match(qtyLimit({ ...s, board: itx }, ram).reason, /ללוח 2 חריצי זיכרון/);
  const small = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5', 589, { max_memory: 48 });
  assert.equal(qtyLimit({ ...s, board: small }, ram).max, 1, '48GB board: one 32GB kit');
  assert.match(qtyLimit({ ...s, board: small }, ram).reason, /48GB/);
  const r = setQty(s, ram, 5);
  assert.equal(qtyOf(r.sel, ram), 2);
  assert.match(r.limited, /4 מקלות/);
  assert.equal(usageOf(r.sel).modules, 4);
  assert.equal(usageOf(r.sel).memoryGb, 64);
});

test('RAM: a board with fewer slots lowers the quantity, and says so', () => {
  const s = setQty(base(), ram, 2).sel;
  const { sel, removed, adjusted } = applyChoice(s, itx);
  assert.equal(removed.length, 0);
  assert.equal(qtyOf(sel, ram), 1);
  assert.deepEqual(adjusted.map((a) => [a.step, a.from, a.to]), [['ram', 2, 1]]);
  assert.match(adjusted[0].reason, /2 חריצי זיכרון/);
});

test('RAM: 4 modules on a board that does not say its slots are "לא אומת", and two kits get the advice', () => {
  const s = setQty(base(), ram, 2).sel;
  const check = checkBuild(s);
  assert.equal(check.ok, true, check.problems.map((p) => p.text).join());
  assert.ok(check.unverified.includes(UNVERIFIED.ramSlots));
  assert.ok(check.notes.some((n) => /ערכה אחת עם כל המקלות/.test(n.text)));
  assert.ok(check.notes.some((n) => /4 מקלות DDR5/.test(n.text)), 'DDR5 6000 ×4 modules');
  const known = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5', 589, { ram_slots: 4 });
  assert.equal(checkBuild({ ...s, board: known }).unverified.includes(UNVERIFIED.ramSlots), false);
});

/* ---------- GPU ---------- */

test('GPU: two cards double the power estimate, and a PSU that no longer carries them is dropped', () => {
  const one = powerOf(base());
  const r = setQty({ ...base(), psu: psu650 }, gpu, 2);
  assert.equal(qtyOf(r.sel, gpu), 2);
  assert.equal(powerOf(r.sel).draw - one.draw, gpu.facts.watts);
  assert.equal(powerOf(r.sel).gpus, 2);
  assert.deepEqual(r.removed.map((x) => x.step), ['psu'], '650W cannot carry two RTX 5070');
  assert.ok(!r.sel.psu);
  // The PSU step then blocks the small PSU with its reason, and an 850W one: still short for 2× 250W + 170W.
  const two = r.sel;
  const p = powerOf({ ...two, psu: psu850 });
  assert.ok(p.recommended > 850, `${p.recommended}`);
  assert.equal(isOrderable({ ...two, psu: psu850 }), false);
});

test('GPU: at most 2, one on a Mini-ITX board or a board with one x16 slot; the dual-GPU note and what to confirm', () => {
  assert.equal(qtyLimit(base(), gpu).max, 2);
  assert.equal(qtyLimit({ ...base(), board: itx }, gpu).max, 1);
  assert.match(qtyLimit({ ...base(), board: itx }, gpu).reason, /חריץ PCIe x16 אחד/);
  const one16 = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5', 589, { pcie_x16: 1 });
  assert.equal(qtyLimit({ ...base(), board: one16 }, gpu).max, 1);
  const big = part('ספק כוח Antec Signature 1300W Platinum ATX 3.1', 1500);
  const s = setQty({ ...base(), psu: big }, gpu, 2).sel;
  const check = checkBuild(s);
  assert.equal(check.ok, true, check.problems.map((p) => p.text).join());
  assert.ok(check.notes.some((n) => /רוב המשחקים לא מנצלים שני כרטיסי מסך/.test(n.text)));
  assert.ok(check.unverified.includes(UNVERIFIED.pcieX16));
  assert.ok(check.unverified.includes(UNVERIFIED.gpuConnectors));
});

test('GPU: the PSU connectors for two cards, when the PSU and the card say them', () => {
  const card = part('כרטיס מסך GIGABYTE Radeon RX 9070 XT GAMING OC 16G', 3000, { pcie_8pin: 2, pcie_16pin: 0 });
  const few = part('ספק כוח Antec Signature 1300W Platinum ATX 3.1', 1500, { pcie_8pin: 3 });
  const many = part('ספק כוח Antec Signature 1300W Platinum ATX 3.1', 1500, { pcie_8pin: 6 });
  const sel = { ...base(), gpu: card, qty: { [card.id]: 2 } };
  const blocked = checkBuild({ ...sel, psu: few });
  assert.equal(blocked.ok, false);
  assert.match(blocked.problems.map((p) => p.text).join(), /3 מחברי PCIe של 8 פין, ול־2 כרטיסי מסך צריך 4/);
  const fine = checkBuild({ ...sel, psu: many });
  assert.equal(fine.problems.length, 0, fine.problems.map((p) => p.text).join());
  assert.equal(fine.unverified.includes(UNVERIFIED.gpuConnectors), false);
  // Two 12V-2x6 cards on a PSU with one such connector.
  const pin16 = { ...gpu, facts: { ...gpu.facts, pin16: true } };
  const one16 = part('ספק כוח Antec Signature 1300W Platinum ATX 3.1', 1500, { pcie_16pin: 1 });
  assert.match(checkBuild({ ...base(), gpu: pin16, psu: one16, qty: { [pin16.id]: 2 } }).problems.map((p) => p.text).join(), /מחבר 12V-2x6 אחד, ול־2 כרטיסי מסך צריך 2/);
});

/* ---------- CPU ---------- */

test('CPU: two only on a dual-socket board, with a clear Hebrew reason otherwise', () => {
  const lim = qtyLimit(base(), cpu);
  assert.equal(lim.max, 1);
  assert.match(lim.reason, /2 מעבדים אפשר רק בלוח אם עם שתי תושבות/);
  assert.match(lim.reason, /הלוח שבחרתם הוא לתושבת אחת/);
  assert.match(qtyLimit({ cpu }, cpu).reason, /עדיין לא נבחר לוח כזה/);
  const r = setQty(base(), cpu, 2);
  assert.equal(qtyOf(r.sel, cpu), 1);
  assert.ok(r.limited);
  const dual = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5', 589, { cpu_sockets: 2 });
  const two = setQty({ ...base(), board: dual, psu: part('ספק כוח 1600W Titanium ATX 3.1', 2000) }, cpu, 2);
  assert.equal(qtyOf(two.sel, cpu), 2);
  assert.equal(powerOf(two.sel).draw - powerOf({ ...base(), board: dual }).draw, cpu.facts.watts);
  // Back to a single-socket board: the processors go back to one.
  const back = applyChoice(two.sel, board);
  assert.equal(qtyOf(back.sel, cpu), 1);
  assert.equal(back.adjusted[0].step, 'cpu');
});

/* ---------- storage ---------- */

test('storage: several drives, held within the M.2 slots (default 2) and SATA ports (default 4)', () => {
  let s = base();
  assert.equal(canAddDrive(s, nvme2).ok, true);
  s = addDrive(s, nvme2).sel;
  assert.deepEqual(lines(s).filter((l) => l.step === 'storage').map((l) => l.part), [nvme, nvme2]);
  assert.equal(usageOf(s).m2, 2);
  const full = canAddDrive(s, nvme3);
  assert.equal(full.ok, false);
  assert.match(full.reason, /2 חריצי M\.2/);
  assert.equal(addDrive(s, nvme3).refused, full.reason);
  assert.equal(qtyLimit(s, nvme2).max, 1, 'no M.2 slot left for a second of it');
  // SATA is separate: four hard disks fit the default.
  s = addDrive(s, hdd).sel;
  s = setQty(s, hdd, 9).sel;
  assert.equal(qtyOf(s, hdd), 4);
  const check = checkBuild(s);
  assert.equal(check.ok, true, check.problems.map((p) => p.text).join());
  assert.ok(check.unverified.includes(UNVERIFIED.m2Slots));
  assert.ok(check.unverified.includes(UNVERIFIED.sataPorts));
  // The board says 4 M.2: a third NVMe fits, and nothing is left to confirm about M.2.
  const z890 = part('לוח לאינטל דור 15 Gigabyte Z890 EAGLE 2.5GbE 4XM.2 Slots ATX LGA1851', 931);
  assert.equal(canAddDrive({ ...s, board: z890 }, nvme3).ok, true);
});

test('storage: removing the main drive promotes the added one; a smaller board drops what has no room', () => {
  let s = addDrive(addDrive(base(), nvme2).sel, hdd).sel;
  s = removeDrive(s, nvme);
  assert.equal(s.storage, nvme2);
  assert.deepEqual(s.drives, [hdd]);
  s = addDrive(s, nvme3).sel;
  const one = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5 1GB LAN', 589, { m2_slots: 1 });
  const { sel, adjusted } = applyChoice(s, one);
  assert.equal(sel.storage, nvme2);
  assert.deepEqual(sel.drives, [hdd]);
  assert.deepEqual(adjusted.map((a) => [a.part.id, a.to]), [[nvme3.id, 0]]);
});

/* ---------- fans, links, totals ---------- */

test('fan packs: up to 6, counted in the power and against the fan headers', () => {
  const s = { ...base(), extra: [fans] };
  const r = setQty(s, fans, 9);
  assert.equal(qtyOf(r.sel, fans), 6);
  assert.equal(powerOf(r.sel).draw - powerOf(base()).draw, 3 * 6 * 2);
  assert.ok(checkBuild(r.sel).unverified.includes(UNVERIFIED.fanHeaders));
});

test('sanitize (a link, a saved build): quantities past the limits come back within them, unused ones go', () => {
  const raw = { ...base(), drives: [nvme2, nvme2, hdd, nvme3], qty: { [cpu.id]: 2, [ram.id]: 9, [gpu.id]: 2, [nvme3.id]: 3, 123: 4 } };
  const { sel, adjusted } = sanitize({ ...raw, psu: part('ספק כוח 1600W Titanium ATX 3.1', 2000) });
  assert.equal(qtyOf(sel, cpu), 1);
  assert.equal(qtyOf(sel, ram), 2);
  assert.equal(qtyOf(sel, gpu), 2);
  assert.deepEqual(sel.drives, [nvme2, hdd], 'a drive listed twice once; no M.2 slot for the third');
  assert.equal(sel.qty[123], undefined);
  assert.ok(adjusted.some((a) => a.step === 'cpu') && adjusted.some((a) => a.step === 'ram'));
  assert.equal(isOrderable(sel), true, checkBuild(sel).problems.map((p) => p.text).join());
  // A hand-made selection over a known limit is not orderable.
  const known = part('לוח אם GIGABYTE B850M D3HP MICRO-ATX DDR5 AM5', 589, { ram_slots: 2 });
  const over = { ...base(), board: known, qty: { [ram.id]: 2 } };
  assert.equal(isOrderable(over), false);
  assert.match(checkBuild(over).problems.map((p) => p.text).join(), /כמות 2: ללוח 2 חריצי זיכרון/);
});

test('lines and totals: one line per part with its quantity, in step order, the added drives after the main one', () => {
  const s = addDrive(setQty(setQty(base(), ram, 2).sel, gpu, 2).sel, hdd).sel;
  const l = lines({ ...s, psu: psu850 });
  assert.deepEqual(l.map((x) => [x.step, x.qty]), [['cpu', 1], ['board', 1], ['ram', 2], ['gpu', 2], ['storage', 1], ['storage', 1], ['cooler', 1], ['psu', 1], ['case', 1]]);
  const total = l.reduce((t, x) => t + x.part.price * x.qty, 0);
  assert.equal(total, 1900 + 589 + 2 * 500 + 2 * 2700 + 300 + 400 + 450 + 600 + 400);
});

test('guided builds and the old selections (no qty, no drives) still work', () => {
  const s = { cpu, board, ram, gpu, storage: nvme, cooler, psu: psu850, case: kase, extra: [] };
  assert.equal(qtyOf(s, ram), 1);
  assert.equal(isOrderable(s), true);
  assert.deepEqual(lines(s).map((x) => x.qty), [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(clampQty(s).adjusted.length, 0);
});

/* ---------- search ---------- */

test('search: normalised text, Hebrew and English, spaces and case ignored', () => {
  assert.equal(normalizeSearch(' RTX-5070 Ti '), 'rtx5070ti');
  assert.equal(normalizeSearch('M.2 2280'), 'm22280');
  assert.equal(normalizeSearch('קירור נוזלי'), 'קירורנוזלי');
  assert.equal(normalizeSearch('לבן'), 'לבנ', 'final letters as regular ones');
  assert.deepEqual(queryWords('רייזן 7'), ['ryzen7']);
  assert.deepEqual(queryWords('1 tb nvme'), ['1tb', 'nvme']);
  assert.deepEqual(queryWords('32 גיגה ddr 5'), ['32gb', 'ddr5']);
});

test('search: finds live parts by model, maker (Hebrew too), chipset, socket and capacity', () => {
  const find = (cat, q) => liveParts.filter((p) => p.category === cat && matchesQuery(p, q));
  const has = (cat, q, re, min = 1) => {
    const found = find(cat, q);
    assert.ok(found.length >= min, `${cat} "${q}": ${found.length}`);
    for (const p of found) assert.match(`${p.title} ${p.brand} ${JSON.stringify(p.facts)}`, re, `${cat} "${q}" matched ${p.title}`);
    return found;
  };
  has('gpu', 'rtx5070', /5070/i);
  has('gpu', 'RTX 5070 TI', /5070 ti/i);
  has('gpu', 'גיגהבייט 5060', /gigabyte.*5060|5060.*gigabyte/i);
  has('board', 'b850m', /b850m/i);
  has('board', 'am5', /AM5/);
  has('cpu', 'רייזן 7', /ryzen 7/i);
  has('cpu', 'i5', /i5/i);
  has('cpu', 'אינטל', /intel/i);
  has('ram', '32gb ddr5', /32/);
  has('storage', '1 tb', /"capacityGb":1000/);
  has('psu', '750w', /750/);
  assert.equal(find('gpu', 'rtx 9999').length, 0);
  assert.equal(find('cpu', '').length, liveParts.filter((p) => p.category === 'cpu').length, 'empty query: everything');
});
