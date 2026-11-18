// Lior's six compatibility rules (assets/pc-builder-parser.js: lior(), SPECS, powerOf): for each rule a pair that
// blocks, a pair that passes, and a pair the data cannot decide ("לא אומת": allowed, flagged for a representative).
// Real titles and SKUs from the collection (fixtures/live-2026-11-18.json); a few facts are set by hand where the
// collection has no part that clashes (marked "synthetic").
// node --test .github/pc-builder/rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChoice, checkBuild, fitOf, isOrderable, planBuilds, powerOf, PSU_HEADROOM, SPECS, STEP_KEYS, toPart, UNVERIFIED } from '../../assets/pc-builder-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(readFileSync(join(here, 'fixtures/live-2026-11-18.json'), 'utf8')).products;
const liveParts = live.map((p) => toPart(p)).filter((p) => p && STEP_KEYS.includes(p.category));
const bySku = new Map(liveParts.map((p) => [p.sku, p]));
/** A live part by its SKU (a fresh copy, so a test may change its facts). */
const sku = (s) => {
  const p = bySku.get(s);
  assert.ok(p, `no live part ${s}`);
  return { ...p, facts: { ...p.facts } };
};
let nextId = 1;
const part = (title, { price = 100, sku: code = null, body = null } = {}) =>
  toPart({ id: 900000 + nextId, title, vendor: '', body_html: body, variants: [{ id: 9000000 + nextId++, price: String(price), available: true, sku: code }], images: [] });

const both = (a, b) => [fitOf(a, { [b.category]: b }), fitOf(b, { [a.category]: a })];
const blocks = (a, b, re) => {
  for (const f of both(a, b)) {
    assert.equal(f.ok, false, `${a.title} + ${b.title} should block`);
    if (re) assert.match(f.reasons.join(' | '), re);
  }
};
const passes = (a, b) => {
  for (const f of both(a, b)) {
    assert.equal(f.ok, true, `${a.title} + ${b.title}: ${f.reasons.join(' | ')}`);
    assert.deepEqual(f.unverified, [], `${a.title} + ${b.title}: ${f.unverified}`);
  }
};
const unverified = (a, b, label) => {
  for (const f of both(a, b)) {
    assert.equal(f.ok, true, `${a.title} + ${b.title} must not block: ${f.reasons.join(' | ')}`);
    assert.ok(f.unverified.includes(label), `${a.title} + ${b.title} should flag "${label}" (got ${f.unverified})`);
  }
};
const noteOf = (a, b) => both(a, b).flatMap((f) => f.notes);

/* ---------- the table ---------- */

test('SPECS: every SKU is a live part of that kind, and its facts land on the part', () => {
  for (const [cat, table] of Object.entries(SPECS)) {
    for (const code of Object.keys(table)) {
      const p = bySku.get(code);
      assert.ok(p, `${cat} ${code} is not in the collection`);
      assert.equal(p.category, cat, `${code}: ${p.title}`);
      assert.equal(p.verified, true, code);
    }
  }
  assert.equal(sku('GVN50801660').facts.length, 360);
  assert.equal(sku('AN1-C5AR').facts.coolerMax, 160);
  assert.equal(sku('NH-D15').facts.height, 168);
  assert.equal(sku('CLM-P7015').facts.atx3, false);
  assert.equal(sku('210-9011349').facts.formFactor, 'E-ATX', 'the WARTHOG takes E-ATX boards (the title says Mid Tower)');
});

test('a description fills what the title lacks (Antec P30 ARGB: "כרטיס מסך באורך עד 405 מ״מ")', () => {
  const c = part('מארז בדיקה ATX Mid-Tower', { body: '<p>מקבל כרטיס מסך באורך עד 405 מ״מ, קירור אוויר למעבד עד 175 מ״מ ורדיאטור עד 240 מ״מ בחלק העליון.</p>' });
  assert.equal(c.facts.gpuMax, 405);
  assert.equal(c.facts.coolerMax, 175);
  assert.deepEqual(c.facts.rad, { any: 240 });
});

/* ---------- 1. CPU ⟷ board ---------- */

test('1. CPU ⟷ board: socket blocks, BIOS and an entry board under a hot processor are advice', () => {
  const i5 = sku('II514400FT'); // i5-14400F
  const ryzen = sku('AMD-R79800X3DT'); // Ryzen 7 9800X3D
  const h610 = sku('95H61011'); // H610M K DDR4
  const b760 = sku('95B76030'); // B760M D3HP DDR4
  const b650 = sku('95B65030'); // B650M D3HP
  const b850 = sku('95B850110'); // B850M D3HP
  blocks(i5, b650, /LGA1700.*AM5|AM5.*LGA1700/);
  passes(ryzen, b850);
  // BIOS: 14th gen on a 600-series board; Ryzen 9000 on a B650; not on the boards that launched with them.
  assert.match(noteOf(i5, h610).join(' '), /BIOS/);
  assert.doesNotMatch(noteOf(i5, b760).join(' '), /BIOS/);
  assert.match(noteOf(ryzen, b650).join(' '), /BIOS/);
  assert.doesNotMatch(noteOf(ryzen, b850).join(' '), /BIOS/);
  assert.match(noteOf(sku('IU7-270KT'), sku('95Z890210')).join(' '), /BIOS/, 'Core Ultra 7 270K Plus on a Z890');
  assert.match(noteOf(sku('AMD-R7985030'), b850).join(' '), /BIOS/, '9850X3D: newer than every board');
  // VRM: no data, so the chipset tier is the hint (advice, never a block).
  const i9 = sku('II914900KT');
  assert.match(noteOf(i9, h610).join(' '), /לוח בסיסי/);
  assert.equal(fitOf(i9, { board: h610 }).ok, true);
  assert.doesNotMatch(noteOf(i9, sku('95Z79070')).join(' '), /לוח בסיסי/);
});

/* ---------- 2. RAM ⟷ board ---------- */

test('2. RAM ⟷ board: DDR generation blocks; sticks and XMP/EXPO are advice; an unnamed profile is not verified', () => {
  const b650 = sku('95B65030');
  blocks(sku('KF4163200'), b650, /DDR5/); // DDR4 stick on an AM5 board
  passes(sku('2CK5-32603809'), b650); // Corsair 2x16 DDR5 6000
  // Strict as before: a board that does not say its memory never matches blindly.
  assert.equal(fitOf(sku('95B760555'), {}).ok, false);
  // Two sticks for fast DDR5.
  assert.match(fitOf(sku('KF5-1166036010'), {}).notes.join(' '), /מקל יחיד/, '1×16GB DDR5 6000');
  assert.doesNotMatch(fitOf(sku('KVD-53260300'), {}).notes.join(' '), /מקל יחיד/, '2×16GB DDR5 6000');
  assert.doesNotMatch(fitOf(sku('CR5-165646'), {}).notes.join(' '), /מקל יחיד/, '5600: below the rule');
  // XMP for Intel, EXPO for AMD.
  const expo = sku('KF5-64603002'); // "… CL30 EXPO RAM"
  const intel = sku('IU7-265KT');
  const amd = sku('AMD-R79800X3DT');
  assert.match(noteOf(expo, intel).join(' '), /EXPO/);
  assert.deepEqual(noteOf(expo, amd).filter((n) => /EXPO|XMP/.test(n)), []);
  assert.match(noteOf(sku('2CK56460302'), amd).join(' '), /XMP/, '"… C30 INTEL XMP" on a Ryzen');
  unverified(sku('2CK5-32603809'), amd, UNVERIFIED.memProfile); // no profile in the title, DDR5 6000
});

/* ---------- 3. GPU ⟷ case + PSU ---------- */

test('3a. GPU ⟷ case: card length against the case', () => {
  const master = sku('GVN50801660'); // AORUS RTX 5080 MASTER, 360 mm
  const cx200m = sku('AN1-CX200M-RE'); // Antec CX200M, cards up to 330 mm
  blocks(master, cx200m, /360.*330|330.*360/);
  passes(sku('GVN50701210'), cx200m); // RTX 5070 EAGLE SFF, 290 mm
  unverified(sku('GVR76001'), cx200m, UNVERIFIED.gpuLength); // RX 7600: not in the table
  unverified(master, sku('AN1-VX310AR'), UNVERIFIED.gpuLength); // a case not in the table
  // A later case choice drops the card that no longer fits (the new choice wins), with the reason.
  const { sel, removed } = applyChoice({ gpu: master }, cx200m);
  assert.equal(sel.gpu, undefined);
  assert.equal(removed[0].step, 'gpu');
});

test('3b. GPU ⟷ PSU: +100W headroom, ATX 3 for RTX 40/50, the card maker\'s PSU as advice', () => {
  for (const cpu of liveParts.filter((p) => p.category === 'cpu'))
    for (const gpu of liveParts.filter((p) => p.category === 'gpu')) {
      const p = powerOf({ cpu, gpu });
      assert.ok(p.recommended >= p.draw + PSU_HEADROOM, `${cpu.title} + ${gpu.title}`);
    }
  const rtx = sku('GVN50701220'); // RTX 5070 GAMING OC, 16-pin, maker says 750W
  blocks(rtx, sku('CLM-P7015'), /ATX/); // Elite NEX W700: ATX12V 2.41
  blocks(sku('GVN5060-8120'), sku('220-CX650278'), /ATX/); // RTX 50 on the CX650 (ATX12V 2.31)
  passes(rtx, sku('220-RM850X270')); // RM850x ATX 3.1
  unverified(rtx, sku('AN2-CSK6502'), UNVERIFIED.atx3); // CSK 650DC: the title does not say
  assert.match(noteOf(rtx, sku('AN2-CSK6502')).join(' '), /750W/);
  // Not RTX 40/50: no ATX 3 rule.
  passes(sku('GVR9070201'), sku('94P10202'));
  assert.deepEqual(fitOf(sku('GVR76001'), { psu: sku('CLM-P7015') }).unverified, []);
});

test('3c. a water-cooled card needs its own radiator place, next to an AIO', () => {
  const waterforce = sku('GVN50801670'); // RTX 5080 XTREME WATERFORCE, 360 mm radiator
  const aio = sku('AN3-SKL3600'); // Antec SKELETON 360
  const fluxM = sku('AN1-FLUX-M'); // one 360 place (top)
  const c5 = sku('AN1-C5AR'); // top 360 + bottom 360
  assert.equal(fitOf(fluxM, { gpu: waterforce, cooler: aio }).ok, false);
  assert.match(fitOf(fluxM, { gpu: waterforce, cooler: aio }).reasons.join(' '), /שני רדיאטורים/);
  assert.equal(fitOf(waterforce, { cooler: aio, case: fluxM }).ok, false);
  assert.equal(fitOf(c5, { gpu: waterforce, cooler: aio }).ok, true);
  assert.ok(fitOf(sku('AN1-VX310AR'), { gpu: waterforce }).unverified.includes(UNVERIFIED.radiator));
});

/* ---------- 4. CPU cooler ⟷ case + RAM + socket ---------- */

test('4a. cooler ⟷ case: air-cooler height; AIO radiator size', () => {
  const d15 = sku('NH-D15'); // 168 mm
  blocks(d15, sku('AN1-C5AR'), /168.*160|160.*168/); // C5 ARGB: up to 160 mm
  passes(d15, sku('AN1-P30')); // P30 Air: up to 175 mm
  unverified(d15, sku('AN1-VX310AR'), UNVERIFIED.coolerHeight);
  unverified(sku('DC-AG400W'), sku('AN1-P30'), UNVERIFIED.coolerHeight); // AG400: height not verified
  // AIO: a 360 radiator in a case whose description allows 240 only.
  const small = part('מארז בדיקה ATX Mid-Tower', { body: 'רדיאטור עד 240 מ״מ' });
  const aio = sku('AN3-SKL3600');
  blocks(aio, small, /360/);
  passes(aio, sku('AN1-FLUX-M'));
  unverified(aio, sku('AN1-CX200M-RE'), UNVERIFIED.radiator); // the maker lists no radiator support
});

test('4b. cooler ⟷ processor: socket bracket, TDP and its headroom', () => {
  const f400 = sku('AN3-F400A'); // 205W, AM4/AM5/LGA1700/1851
  passes(f400, sku('AMD-R77700XT'));
  const amOnly = sku('AN3-F400A');
  amOnly.facts.sockets = ['AM5', 'AM4']; // synthetic: no cooler in the collection lacks a desktop socket
  blocks(amOnly, sku('IU7-265KT'), /LGA1851/);
  unverified(sku('94LEE361'), sku('IU7-265KT'), UNVERIFIED.coolerSocket); // GIGABYTE EAGLE 360: sockets not verified
  blocks(sku('AN3-A450FR'), sku('II914900KT'), /180W|253W/); // 180W cooler under a 253W processor (as before)
  assert.match(noteOf(sku('AN3-A450FR'), sku('II514600KT')).join(' '), /מרווח קטן/, '180W cooler for a 181W peak');
  assert.doesNotMatch(noteOf(sku('NH-D15'), sku('AMD-R77700XT')).join(' '), /מרווח קטן/);
});

test('4c. cooler ⟷ RAM: clearance under a dual-tower cooler', () => {
  const f620 = sku('AN3-F620DP'); // RAM up to 40 mm under the front fan
  const ram = sku('2CH5-32603800');
  unverified(f620, ram, UNVERIFIED.ramClearance); // no RAM heights in the data
  const tall = { ...ram, facts: { ...ram.facts, height: 44 } }; // synthetic: 44 mm modules
  blocks(f620, tall, /40.*44|44.*40/);
  const low = { ...ram, facts: { ...ram.facts, height: 34 } }; // synthetic: 34 mm modules
  passes(f620, low);
  assert.deepEqual(fitOf(sku('AN3-F400A'), { ram }).unverified, [], 'a single tower leaves the slots free');
});

/* ---------- 5. Storage ⟷ board ---------- */

test('5. storage ⟷ board: M.2 length and PCIe generation', () => {
  const gen5 = sku('SSD-SM9100P1T'); // Samsung 9100 PRO Gen5
  const b650 = sku('95B65030'); // M.2 PCIe 4.0 (Gigabyte spec)
  const x870 = sku('95X870100'); // X870: a PCIe 5.0 M.2 slot on every board
  assert.match(noteOf(gen5, b650).join(' '), /PCIe 5\.0/);
  assert.equal(fitOf(gen5, { board: b650 }).ok, true, 'a Gen5 drive works in a Gen4 slot: advice, not a block');
  assert.deepEqual(noteOf(gen5, x870), []);
  const nv3 = sku('KSSD-SNV3S1000'); // "M.2 2280" in the title
  passes(nv3, b650);
  unverified(sku('SSD-SM990P1T'), b650, UNVERIFIED.m2); // 990 PRO: the title does not give its length
  unverified(gen5, sku('95Z890210'), UNVERIFIED.m2); // Z890 EAGLE: M.2 generation not verified
  assert.deepEqual(fitOf(sku('ST4000DM004'), { board: b650 }).unverified, [], 'a SATA disk needs no M.2 slot');
});

/* ---------- 6. Case ⟷ system ---------- */

test('6. case ⟷ system: board size, rear connectors, PSU size, front USB-C and fan headers', () => {
  const atx = sku('95B850320'); // B850 GAMING X WIFI6E ATX
  blocks(atx, sku('AN1-ST10MTG'), /mATX|ATX/); // mATX case
  passes(sku('95B65030'), sku('AN1-AX1000')); // mATX board, E-ATX case with a fan hub; the board's USB-C header is verified
  const stealth = sku('95B850370'); // rear-connector board
  blocks(stealth, sku('AN1-C5AR'), /מאחור/);
  assert.equal(fitOf(stealth, { case: sku('210-9011349') }).ok, true, 'the WARTHOG takes rear-connector boards');
  // PSU size (synthetic: the collection has no SFX case or PSU).
  const sfxCase = { ...sku('AN1-C2MA'), facts: { ...sku('AN1-C2MA').facts, psu: 'SFX' } };
  blocks(sku('220-RM850X270'), sfxCase, /SFX/);
  // Front USB-C: the B650M D3HP has the header; most boards are not verified; a board without one gets advice.
  const b650 = sku('95B65030');
  const c5 = sku('AN1-C5AR'); // USB-C front port, 7 fans, no hub
  assert.ok(!fitOf(c5, { board: b650 }).unverified.includes(UNVERIFIED.usbc));
  unverified(c5, sku('95A52013'), UNVERIFIED.usbc);
  const noHeader = { ...b650, facts: { ...b650.facts, usbcHeader: false } }; // synthetic
  assert.match(noteOf(c5, noHeader).join(' '), /USB-C/);
  // Fans: 7 fans and no hub against 2 system fan headers → not verified; a case with a hub → fine.
  assert.ok(fitOf(c5, { board: b650 }).unverified.includes(UNVERIFIED.fanHeaders));
  assert.ok(!fitOf(sku('AN1-AX1000'), { board: b650 }).unverified.includes(UNVERIFIED.fanHeaders));
});

/* ---------- the whole build ---------- */

test('a build with unverified pairs is still orderable, and says what a representative will confirm', () => {
  const sel = {
    cpu: sku('AMD-R77700XT'),
    board: sku('95B65030'),
    ram: sku('2CK5-32603809'),
    gpu: sku('GVR76001'), // length not in the table
    storage: sku('KSSD-SNV3S1000'),
    cooler: sku('AN3-F400A'),
    psu: sku('AN2-CSK6502'),
    case: sku('AN1-VX310AR'), // not in the table
    extra: [],
  };
  const check = checkBuild(sel);
  assert.equal(check.ok, true, check.problems.map((p) => p.text).join(' | '));
  assert.equal(isOrderable(sel), true);
  assert.ok(check.unverified.includes(UNVERIFIED.gpuLength));
  assert.ok(check.unverified.includes(UNVERIFIED.coolerHeight));
  assert.ok(check.notes.some((n) => /BIOS/.test(n.text)) === false, 'Ryzen 7000 on B650: no BIOS note');
});

test('live: guided builds still pass every check, with the new rules in force', () => {
  for (const use of ['gaming', 'work', 'office'])
    for (const budget of [4000, 8000, 15000]) {
      const builds = planBuilds(liveParts, { use, budget });
      for (const b of builds) assert.equal(b.check.ok, true, `${use} ₪${budget} ${b.key}: ${b.check.problems.map((p) => p.text).join(' | ')} ${b.check.missing}`);
    }
});
