// Unit tests for assets/pc-builder-parser.js: node --test .github/pc-builder/parser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChoice, brandOf, categorize, checkBuild, earlierOf, fitOf, isOrderable, parseTitle, planBuilds, powerOf, sanitize, STEP_KEYS, toPart } from '../../assets/pc-builder-parser.js';
import { aimScore, cpuClassOf, estimateBuild, estimateFps, fpsText, GAMES, GPU_FPS, igpuOf, targetFor } from '../../assets/pc-builder-fps.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/products.json'), 'utf8')).products;
const facts = (title, o) => parseTitle(title, o).facts;
const fixtureParts = fixture.map((p) => toPart(p)).filter((p) => p && STEP_KEYS.includes(p.category));
let nextId = 1;
const part = (title, price = 100, overrides = {}) => toPart({ id: nextId, title, vendor: 'Joy Mobile Merkaz', variants: [{ id: nextId++ * 10, price: String(price), available: true }], images: [] }, overrides);

test('categories from the supplier titles', () => {
  const cases = {
    'מעבד AMD Ryzen 7 9800X3D ZEN5 AM5 8 Cores 16 Threads up to 5.2Ghz': 'cpu',
    'לוח אם GIGABYTE B850M DS3H DDR5 MICRO-ATX AM5 2.5GBE LAN': 'board',
    'זכרון לנייח Corsair Vengeance 32GB 2X16 DDR5 6000 C38': 'ram',
    'ז.לנייח Corsair DDR4 Vengeance LPX 8GB 3200MHZ C16 FOR INTEL XMP': 'ram',
    'Kingston Fury Beast DDR5 64GB 2x32GB 6000MHZ DDR5 CL30 EXPO RAM': 'ram',
    'כ.מסך GIGABYTE GeForce RTX 5070 AERO OC 12G': 'gpu',
    'דיסק פנימי Samsung 990 PRO 1TB GEN4 up to 7450 read 6900 Write': 'storage',
    'ספק כוח ANTEC ATOM G750 120MM Silent Fan Semi-Modular 80Plus Gold': 'psu',
    'מארז שחור Antec C5 ARGB Mid-Tower ATX 7x ARGB FANS Incl Type-C': 'case',
    'ANTEC P30 ARGB Black ATX Case 2x140mm and 3x120mm Fans': 'case',
    'ק.נוזלי Cooler Master 360 Core II Black 280W TDP Intel/Amd': 'cooler',
    'מאוורר NOCTUA NH-D15 250W TDP DUAL 140mm FAN Intel/Amd Black': 'cooler',
    'Cooler Master Hyper 212 3DHP ARGB Black Edition CPU Air Cooler': 'cooler',
    'מערכת הפעלה עברית Windows 11 Home Edition 64Bit': 'os',
    'מאווררים למארז Antec Orbit 120 ARGB 3 Pack': 'extra',
    'משחה טרמית Corsair TM30 2.5gr': 'extra',
    'זכוכית למארז ANTEC AX83': 'ignore',
    'ספק כח ממותג Provision PSU DC Adapter 12V 1A': 'ignore',
    'כרטיס זכרון SanDisk 128GB Ultra microSDXC UHS-I Up to 140MB/s C10': 'ignore',
    'מתאם לספק Cooler Master 12VHPWR Adapter Cable up to 600W 90 Degre': 'ignore',
    'מחשב גיימינג C5 ARGB 850W B860M WIFI U7 265K 32GB 1TB RTX 5070': 'system',
    'נייד ASUS TUF A16 R7-260 16GB 1TB RTX5050 16 DOS Gray': 'system',
  };
  for (const [title, cat] of Object.entries(cases)) assert.equal(categorize(title), cat, title);
});

test('every fixture title is recognized', () => {
  const unknown = fixture.filter((p) => categorize(p.title) === null).map((p) => p.title);
  assert.deepEqual(unknown, []);
});

test('CPU socket, graphics, cooler and power', () => {
  assert.deepEqual(
    (({ socket, igpu, needsCooler }) => ({ socket, igpu, needsCooler }))(facts('מעבד Intel Core Ultra 5 245KF Tray No GPU No Fans Up To 5.2GHz')),
    { socket: 'LGA1851', igpu: false, needsCooler: true },
  );
  assert.equal(facts('מעבד Intel Core Ultra 7 265K Tray Up To 5.5GHz NPU LGA 1851').igpu, true);
  assert.equal(facts('מעבד Intel Core I5-14400F Tray No GPU 4.7 Ghz No Fan 65W TDP').socket, 'LGA1700');
  assert.equal(facts('מעבד Intel Core I5-14400F Tray No GPU 4.7 Ghz No Fan 65W TDP').watts, 148, 'peak, not the base 65W');
  assert.equal(facts('מעבד AMD Ryzen 5 5600 3.5Ghz 4.4Ghz AM4 Tray no Fan No GPU').socket, 'AM4');
  assert.equal(facts('מעבד AMD Ryzen 7 5700X Tray 8C 16T 4.6GHz AM4 65W No GPU').igpu, false);
  assert.equal(facts('מעבד AMD Ryzen R5 5600X Tray 6 Cores Threads 12 Up to 4.6Ghz').igpu, false, 'Ryzen 5000 non-G has no graphics');
  assert.equal(facts('מעבד AMD ZEN 4 R5 8500G Tray no fan up to 5GHZ RADEON 740M GPU').igpu, true);
  assert.equal(facts('מעבד AMD Ryzen 5 8400F Zen4 6 Cores 12 Threads Up to 4.7GHz').igpu, false);
  assert.equal(facts('מעבד AMD Ryzen 5 8400F Zen4 6 Cores 12 Threads Up to 4.7GHz').socket, 'AM5');
  assert.equal(facts('מעבד AMD Ryzen 9 9950X3D2 Dual TRAY 16C 32Thr TDP Max 200W').watts, 200);
  assert.equal(facts('מעבד AMD Ryzen7 9850X3D Tray With Radeon Graphics AM5').igpu, true);
  assert.equal(facts('מעבד Intel Core Ultra 7 265KF Box Up To 5.5GHz NPU LGA 1851').needsCooler, true, 'K parts ship without a cooler');
});

test('board socket from the chipset, memory and form factor', () => {
  const b = facts('לוח לאינטל דור 15 Gigabyte Z890 EAGLE 2.5GbE 4XM.2 Slots ATX LGA1');
  assert.equal(b.socket, 'LGA1851', 'cut-off LGA token: from the Z890 chipset');
  assert.equal(b.memory, 'DDR5');
  assert.equal(facts('לוח למעבד דור 15 Gigabyte B860M AORUS ELITE WIFI6E ATX 2.5GB LAN').formFactor, 'mATX', 'M chipset wins over "ATX"');
  assert.equal(facts('לוח אם Gigabyte H610i DDR4 Mini-ITX LGA1700 VGA HDMI 2XDP').formFactor, 'Mini-ITX');
  assert.equal(facts('לוח אם GIGABYTE X870E AORUS PRO ICE ATX DDR5 WIFI7 AM5 2.5GBE LAN').socket, 'AM5');
  assert.equal(facts('לוח Gigabyte B550 EAGLE WIFI6 ATX AM4 DDR4 BT HDMI').memory, 'DDR4');
  assert.equal(facts('לוח אם Gigabyte A520M H ARGB AM4 DDR4 Micro-Atx HDMI DP').socket, 'AM4');
  assert.equal(facts('לוח Gigabyte B760M AORUS ELITE WIFI 6E GEN 5 mATX BT').memory, null, 'LGA1700 boards come in both');
  assert.equal(facts('לוח אם Gigabyte B760M DS3H WF6E GEN5 Micro-Atx DDR5').memory, 'DDR5');
  assert.equal(facts('לוח אם עם מחברי חשמל מאחור Gigabyte B850 A STEALTH AM5 DDR5 WIFI7').backConnect, true);
});

test('memory, cards, PSUs, cases, coolers, storage', () => {
  assert.deepEqual((({ memory, capacity, speed }) => ({ memory, capacity, speed }))(facts('זכרון קיט לנייח CORSAIR Vengeance LPX 2X16 32GB DDR4 3200 CL16')), { memory: 'DDR4', capacity: 32, speed: 3200 });
  assert.equal(facts('Kingston Fury Beast DDR5 64GB 2x32GB 6000MHZ DDR5 CL30 EXPO RAM').capacity, 64);
  assert.equal(facts('כרטיס מסך GIGABYTE GeForce RTX 5070 Ti EAGLE OC SFF 16G').chip, 'RTX 5070 Ti');
  assert.equal(facts('כ. מסך Gigabyte 5060 Windforce2 MAX OC 8GB PCIE-5.0 3XDP 1XHDMI').chip, 'RTX 5060');
  assert.equal(facts('כרטיס מסך GIGABYTE AORUS Radeon RX9070 XT ELITE 16G').chip, 'RX 9070 XT');
  assert.equal(facts('כרטיס מסך Gigabyte RX 9070 GRE GAMING OC 12GB GDDR6').chip, 'RX 9070 GRE');
  assert.equal(facts('כרטיס מסך Gigabyte GT 1030 2GB DDR4 DVI HDMI Low Profile').watts, 30);
  assert.equal(facts('ספק כוח Corsair RM850x SHIFT 80plus Gold Fully Modular ATX ATX3.1').watts, 850);
  assert.equal(facts('ספק כוח GIGABYTE GME1000GM PG5 1000W Gold Fully Modular').watts, 1000);
  assert.equal(facts('ספק Cooler Master ELITE NEX 700 230V 80 Plus White Active PFC').watts, 700);
  assert.equal(facts('ספק כוח Gigabyte UD1600PM PG5 AI TOP 80 Plus Platinum Modular').watts, 1600);
  assert.equal(facts('מארז Antec Flux M Mid Tower Micro-ATX ARGB Type-C 3.2').formFactor, 'mATX');
  assert.equal(facts('מארז Antec AX1000 ARGB Mid Tower E-ATX 4X140MM ARGB SIDE GLASS').formFactor, 'E-ATX');
  assert.equal(facts('מארז GIGABYTE C500 PANORAMIC STEALTH Mid-Tower4X120mm ARGB Fans').backConnect, true);
  assert.deepEqual((({ type, tdp }) => ({ type, tdp }))(facts('קירור נוזלי משולש Antec SKELETON 360 ARGB Black INTEL/AMD')), { type: 'liquid', tdp: 280 });
  assert.equal(facts('מאורר למעבד Antec A30 Pro blue led Cpu Cooler TDP UP TO 95W').tdp, 95);
  assert.deepEqual((({ kind, capacityGb }) => ({ kind, capacityGb }))(facts('דיסק פנימי Samsung 990 PRO 2TB GEN4 up to 7450 read 6900 Write')), { kind: 'NVMe', capacityGb: 2000 });
  assert.equal(facts('דיסק פנימי Seagate BarraCuda 8TB 3.5 5400RPM 256MB Cache').kind, 'HDD');
});

test('a pc.* metafield wins over the title', () => {
  const f = parseTitle('לוח Gigabyte B760M AORUS ELITE WIFI 6E GEN 5 mATX BT', { memory: 'DDR5' });
  assert.equal(f.facts.memory, 'DDR5');
  assert.deepEqual(f.fromMeta, ['memory']);
  assert.deepEqual(f.missing, []);
  assert.equal(parseTitle('מעבד מסתורי בלי פרטים', { category: 'cpu', socket: 'lga 1851', igpu: 'false', watts: '125' }).facts.socket, 'LGA1851');
  assert.equal(parseTitle('מארז X', { form_factor: 'E-ATX' }).facts.formFactor, 'E-ATX');
  assert.equal(parseTitle('זכוכית למארז ANTEC AX83', { category: 'extra' }).category, 'extra');
  assert.equal(parseTitle('מעבד AMD Ryzen 5 5600', { category: 'none' }).category, 'ignore');
});

test('brands: the maker, not the platform or the store', () => {
  assert.equal(brandOf('לוח אם Gigabyte AMD A520M K V2 rev 1.1 DDR4 For AM4', 'Joy Mobile Merkaz', 'board'), 'Gigabyte');
  assert.equal(brandOf('מעבד AMD Ryzen 5 5600', 'Joy Mobile Merkaz', 'cpu'), 'AMD');
  assert.equal(brandOf('כרטיס מסך GeForce RTX 5080 AERO OC SFF 16G White', 'Joy Mobile Merkaz', 'gpu'), 'Gigabyte');
  assert.equal(brandOf('מארז XYZ', 'Joy Mobile Merkaz', 'case'), 'Xyz');
});

test('compatibility reasons', () => {
  const cpu = part('מעבד AMD Ryzen 7 9800X3D ZEN5 AM5 8 Cores 16 Threads up to 5.2Ghz', 1600);
  const intelBoard = part('לוח אם Gigabyte Z790 EAGLE ATX DDR5 2.5GB Lan', 700);
  const amBoard = part('לוח אם GIGABYTE B850M DS3H DDR5 MICRO-ATX AM5 2.5GBE LAN', 650);
  const ddr4 = part('זכרון לנייח Kingston Fury Beast DDR4 16GB 3200Mhz C16', 300);
  const smallCase = part('מארז Antec ST10M TG Mini Tower Micro-Atx Black Glass Side Panel', 150);
  const atxBoard = part('לוח אם GIGABYTE B850 GAMING X WIFI6E ATX DDR5 AM5 BT 2.5 GBE LAN', 800);
  const weakCooler = part('מאורר למעבד Antec A30 Pro blue led Cpu Cooler TDP UP TO 95W', 60);
  const gpu = part('כרטיס מסך Gigabyte GeForce RTX 5080 GAMING OC 16G', 6000);
  const psu = part('ספק CORSAIR CX650 Non modular 650W 80 Plus Bronze PSU', 250);
  const stealth = part('לוח אם עם מחברי חשמל מאחור Gigabyte B850 A STEALTH AM5 DDR5 WIFI7', 900);

  assert.equal(fitOf(intelBoard, { cpu }).ok, false);
  assert.match(fitOf(intelBoard, { cpu }).reasons[0], /LGA1700.*AM5/);
  assert.equal(fitOf(amBoard, { cpu }).ok, true);
  assert.equal(fitOf(ddr4, { cpu, board: amBoard }).ok, false);
  assert.equal(fitOf(ddr4, { cpu }).ok, false, 'without a board, the CPU decides the memory');
  assert.equal(fitOf(smallCase, { board: atxBoard }).ok, false);
  assert.equal(fitOf(smallCase, { board: amBoard }).ok, true);
  assert.equal(fitOf(weakCooler, { cpu }).ok, false);
  assert.equal(fitOf(psu, { cpu, gpu }).ok, false);
  assert.equal(fitOf(gpu, { cpu, psu }).ok, false);
  assert.equal(fitOf(part('מארז Antec C5 ARGB Mid-Tower ATX', 300), { board: stealth }).ok, false);
  assert.equal(powerOf({ cpu, gpu }).recommended, 850);

  const ok = checkBuild({ cpu, board: amBoard, ram: part('זכרון לנייח Corsair Vengeance 32GB 2X16 DDR5 6000 C38', 900), storage: part('דיסק פנימי Kingston NV3 1TB NVME GEN 4.0 M.2 2280', 300), psu: part('ספק כוח Corsair RM850x 850W Gold ATX 3.1 Fully Modular', 500), case: part('מארז Antec C5 ARGB Mid-Tower ATX', 300), cooler: part('קירור למעבד Antec F400 ARGB Black 205W 120mm PWM 4 Heatpipes', 120), gpu });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const bad = checkBuild({ cpu, board: intelBoard });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.length, 1, 'one problem per pair');
  assert.ok(bad.missing.includes('ram'));
});

test('guided builds are complete, compatible and within the target', () => {
  const parts = fixture.map((p) => toPart(p)).filter((p) => p && STEP_KEYS.includes(p.category));
  for (const use of ['gaming', 'work', 'office']) {
    for (const budget of [4000, 6000, 9000, 15000]) {
      const builds = planBuilds(parts, { use, budget, includeOs: true });
      assert.equal(builds.length, 3);
      const floor = Math.min(...builds.map((b) => b.total));
      for (const b of builds) {
        assert.equal(b.check.ok, true, `${use} ${budget} ${b.key}: ${JSON.stringify(b.check.problems)} ${b.check.missing}`);
        assert.ok(b.parts.os, 'Windows included');
        if (floor <= b.target) assert.ok(b.total <= b.target + 1, `${use} ${budget} ${b.key}: ${b.total} > ${b.target}`);
        if (use === 'office') assert.ok(!b.parts.gpu, 'office: graphics on the processor');
      }
      assert.ok(builds[0].total <= builds[1].total && builds[1].total <= builds[2].total + 1, `${use} ${budget}: tiers in order`);
    }
  }
});

/* ---------- strict compatibility ---------- */

const am5 = () => ({
  cpu: part('מעבד AMD Ryzen 7 9800X3D ZEN5 AM5 8 Cores 16 Threads up to 5.2Ghz', 1600),
  board: part('לוח אם GIGABYTE B850M DS3H DDR5 MICRO-ATX AM5 2.5GBE LAN', 650),
  ram: part('זכרון לנייח Corsair Vengeance 32GB 2X16 DDR5 6000 C38', 900),
  gpu: part('כרטיס מסך Gigabyte GeForce RTX 5070 AERO OC 12G', 3900),
  storage: part('דיסק פנימי Kingston NV3 1TB NVME GEN 4.0 M.2 2280', 300),
  cooler: part('קירור למעבד Antec F400 ARGB Black 205W 120mm PWM 4 Heatpipes', 120),
  psu: part('ספק כוח Corsair RM850x 850W Gold ATX 3.1 Fully Modular', 500),
  case: part('מארז Antec C5 ARGB Mid-Tower ATX', 300),
});

test('changing an earlier part drops the later parts that no longer fit, with the reason', () => {
  const sel = { ...am5(), extra: [] };
  assert.equal(isOrderable(sel), true, JSON.stringify(checkBuild(sel).problems));
  const intel = part('מעבד Intel Core Ultra 7 265K 20 Cores up to 5.5GHz LGA1851 Box', 1200);
  const { sel: next, removed } = applyChoice(sel, intel);
  assert.equal(next.cpu, intel);
  assert.deepEqual(removed.map((r) => r.step), ['board', 'cooler'], 'the AM5 board and the 205W cooler (the 265K reaches 250W) go; DDR5 memory and the rest still fit');
  assert.match(removed[0].reason, /LGA1851/);
  assert.match(removed[1].reason, /205W/);
  assert.equal(checkBuild(next).problems.length, 0);
  assert.equal(isOrderable(next), false, 'a build without a board cannot be ordered');
  // A weaker PSU after a big card: the card wins, the PSU goes.
  const big = part('כרטיס מסך Gigabyte GeForce RTX 5080 GAMING OC 16G', 6000);
  const small = part('ספק CORSAIR CX650 Non modular 650W 80 Plus Bronze PSU', 250);
  const withSmall = applyChoice(sel, small);
  assert.deepEqual(withSmall.removed.map((r) => r.step), []);
  const after = applyChoice(withSmall.sel, big);
  assert.deepEqual(after.removed.map((r) => r.step), ['psu']);
  // A DDR4 board pulls out DDR5 memory.
  const am4 = applyChoice(sel, part('מעבד AMD Ryzen 5 5600 6 Cores AM4 Box', 400));
  assert.ok(am4.removed.some((r) => r.step === 'board'));
  assert.ok(am4.removed.some((r) => r.step === 'ram'), 'DDR5 memory does not go with an AM4 processor');
});

test('a shared link or a saved build with a bad pair is cleaned in step order', () => {
  const s = am5();
  const intelBoard = part('לוח אם Gigabyte Z790 EAGLE ATX DDR5 2.5GB Lan', 700);
  const ddr4 = part('זכרון לנייח Kingston Fury Beast DDR4 16GB 3200Mhz C16', 300);
  const tiny = part('מארז Antec ST10M TG Mini Tower Micro-Atx Black Glass Side Panel', 150);
  const atx = part('לוח אם GIGABYTE B850 GAMING X WIFI6E ATX DDR5 AM5 BT 2.5 GBE LAN', 800);
  const { sel, removed } = sanitize({ ...s, board: intelBoard, ram: ddr4, extra: [] });
  assert.equal(sel.cpu, s.cpu, 'the earlier step wins');
  assert.ok(!sel.board && !sel.ram);
  assert.deepEqual(removed.map((r) => r.step), ['board', 'ram']);
  const caseClash = sanitize({ ...s, board: atx, case: tiny, extra: [] });
  assert.deepEqual(caseClash.removed.map((r) => r.step), ['case']);
  // Whatever goes in, what comes out has no problem pair.
  for (let i = 0; i < 200; i++) {
    const pick = {};
    for (const k of ['cpu', 'board', 'ram', 'gpu', 'cooler', 'psu', 'case']) {
      const list = fixtureParts.filter((p) => p.category === k);
      pick[k] = list[(i * 7919 + k.length * 104729) % list.length];
    }
    const clean = sanitize({ ...pick, extra: [] }).sel;
    assert.equal(checkBuild(clean).problems.length, 0, `random build ${i}`);
  }
});

test('unknown facts never pass: a board without its memory type, an unrated cooler on a hot processor', () => {
  const unknown = part('לוח Gigabyte B760M AORUS ELITE WIFI 6E GEN 5 mATX BT', 700);
  assert.deepEqual(unknown.missing, ['memory']);
  const i5 = part('מעבד Intel Core i5-14400F 10 Cores LGA1700 Box', 600);
  assert.equal(fitOf(unknown, {}).ok, false, 'blocked even on its own');
  assert.equal(fitOf(unknown, { cpu: i5 }).ok, false);
  assert.match(fitOf(unknown, { cpu: i5 }).reasons[0], /סוג זיכרון/);
  assert.equal(sanitize({ cpu: i5, board: unknown, extra: [] }).sel.board, undefined);
  // A pc.memory metafield confirms it.
  const confirmed = toPart({ id: 1, title: unknown.title, variants: [{ id: 2, price: '700', available: true }] }, { memory: 'DDR5' });
  assert.equal(fitOf(confirmed, { cpu: i5 }).ok, true);
  assert.equal(fitOf(part('זכרון לנייח Corsair Vengeance 32GB 2X16 DDR5 6000 C38', 900), { cpu: i5, board: confirmed }).ok, true);
  // Every fixture part with a missing fact is blocked in every step.
  for (const p of fixtureParts.filter((x) => x.missing.length)) assert.equal(fitOf(p, {}).ok, false, p.title);
  // A cooler without a rating: fine up to 150W, not for a 250W processor (either order).
  const unrated = part('Cooler Master Hyper 212 3DHP ARGB Black Edition CPU Air Cooler', 150);
  assert.equal(unrated.facts.tdp, null);
  const hot = part('מעבד Intel Core Ultra 9 285K 24 Cores LGA1851 Tray', 2200);
  assert.ok(hot.facts.watts > 150);
  assert.equal(fitOf(unrated, { cpu: hot }).ok, false);
  assert.equal(fitOf(hot, { cooler: unrated }).ok, false);
  assert.equal(fitOf(unrated, { cpu: part('מעבד AMD Ryzen 5 7600X AM5 Tray', 600) }).ok, true);
});

test('orderable: complete for its required steps and no problem pair', () => {
  const s = am5();
  assert.equal(isOrderable({ ...s, extra: [] }), true);
  const { gpu, ...noCard } = s;
  assert.equal(isOrderable({ ...noCard, extra: [] }), true, '9800X3D has graphics: a card is optional');
  const f = part('מעבד AMD Ryzen 5 7500F 6 Cores AM5 Tray', 500);
  assert.equal(isOrderable({ ...noCard, cpu: f, extra: [] }), false, 'an F processor needs a card');
  assert.deepEqual(checkBuild({ ...noCard, cpu: f }).missing, ['gpu']);
  const { cooler, ...noCooler } = s;
  assert.equal(isOrderable({ ...noCooler, extra: [] }), false, 'a processor without a cooler in the box needs one');
  const stealth = part('לוח אם עם מחברי חשמל מאחור Gigabyte B850 A STEALTH AM5 DDR5 WIFI7', 900);
  assert.equal(isOrderable({ ...s, board: stealth, extra: [] }), false, 'rear-connector board in a regular case');
  // earlierOf: only the steps before.
  assert.deepEqual(Object.keys(earlierOf(s, 'psu')), ['cpu', 'board', 'ram', 'gpu', 'storage', 'cooler']);
});

/* ---------- FPS estimates ---------- */

test('every graphics card and processor in the supplier list has an estimate', () => {
  for (const p of fixtureParts.filter((x) => x.category === 'gpu')) assert.ok(GPU_FPS[p.facts.chip], p.facts.chip);
  for (const p of fixtureParts.filter((x) => x.category === 'cpu')) {
    assert.ok(cpuClassOf(p), p.title);
    if (p.facts.igpu) assert.ok(igpuOf(p), p.facts.model);
    else assert.equal(igpuOf(p), null);
  }
  for (const [chip, row] of Object.entries(GPU_FPS))
    for (const g of GAMES) {
      const [a, b] = row[g.key];
      assert.ok(a > 0 && b > 0 && b <= a, `${chip} ${g.key}: 1440p not above 1080p`);
    }
});

test('FPS lookup: the card, the processor cap, the game cap, 4K', () => {
  const cpu = (title) => part(title, 500);
  const gpu = (title) => part(title, 2000);
  const x3d = cpu('מעבד AMD Ryzen 7 9800X3D ZEN5 AM5 8 Cores 16 Threads up to 5.2Ghz');
  const i3 = cpu('מעבד Intel Core i3-14100 4 Cores LGA1700 Box');
  const r5070 = gpu('כרטיס מסך Gigabyte GeForce RTX 5070 AERO OC 12G');
  const r5080 = gpu('כרטיס מסך Gigabyte GeForce RTX 5080 GAMING OC 16G');
  assert.deepEqual(estimateFps({ cpu: x3d, gpu: r5070 }, 'cyberpunk', '1080p'), { fps: 115, bound: 'gpu' });
  assert.deepEqual(estimateFps({ cpu: x3d, gpu: r5070 }, 'cyberpunk', '1440p'), { fps: 80, bound: 'gpu' });
  assert.deepEqual(estimateFps({ cpu: x3d, gpu: r5070 }, 'cyberpunk', '4k'), { fps: 40, bound: 'gpu' });
  assert.deepEqual(estimateFps({ cpu: i3, gpu: r5080 }, 'cs2', '1080p'), { fps: 180, bound: 'cpu' }, 'an entry processor holds back an esports title');
  assert.deepEqual(estimateFps({ cpu: x3d, gpu: r5080 }, 'fc', '1080p'), { fps: 240, bound: 'game' });
  // No card: the processor's own graphics; none at all for an F part.
  assert.equal(estimateFps({ cpu: i3 }, 'valorant', '1080p').fps, 31);
  assert.equal(estimateFps({ cpu: cpu('מעבד AMD Ryzen 5 7500F 6 Cores AM5 Tray') }, 'valorant', '1080p'), null);
  assert.equal(fpsText(12), '<30');
  assert.equal(fpsText(null), '—');
  assert.equal(targetFor('cs2', '1080p'), 144);
  assert.equal(targetFor('cs2', '4k'), 60);
  const rows = estimateBuild({ cpu: x3d, gpu: r5070 }, ['cs2', 'cyberpunk'], '1440p');
  assert.deepEqual(rows.map((r) => [r.key, r.meets]), [['cs2', true], ['cyberpunk', true]]);
  assert.equal(estimateBuild({ cpu: x3d, gpu: r5070 }, [], '1080p').length, GAMES.length, 'no games chosen: all of them');
  assert.equal(aimScore({ cpu: x3d, gpu: r5070 }, ['cyberpunk'], '1440p'), 1);
  assert.ok(aimScore({ cpu: i3 }, ['cyberpunk'], '1440p') < 0.1);
});

test('games-first: with games and a resolution, the builds buy frames up to the target', () => {
  const games = ['cyberpunk', 'warzone'];
  const res = '1440p';
  const aim = { score: (sel) => aimScore(sel, games, res) };
  const plain = planBuilds(fixtureParts, { use: 'gaming', budget: 8000, includeOs: true });
  const aimed = planBuilds(fixtureParts, { use: 'gaming', budget: 8000, includeOs: true, aim });
  for (const b of aimed) {
    assert.equal(b.check.ok, true, `${b.key}: ${JSON.stringify(b.check.problems)}`);
    assert.ok(b.total <= b.target + 1, `${b.key} within its target`);
  }
  const score = (b) => aimScore(b.parts, games, res);
  aimed.forEach((b, i) => assert.ok(score(b) >= score(plain[i]) - 1e-9, `${b.key}: aiming never lowers the frame rate`));
  assert.ok(estimateBuild(aimed[1].parts, games, res).every((r) => r.meets), 'the recommended 8,000 build meets 60/90 FPS at 1440p');
  // A budget too small for the target still gives the best it can, within the budget.
  const low = planBuilds(fixtureParts, { use: 'gaming', budget: 4000, includeOs: true, aim: { score: (sel) => aimScore(sel, ['cyberpunk'], '4k') } });
  for (const b of low) assert.equal(b.check.ok, true);
});
